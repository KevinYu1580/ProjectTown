import AppKit
import ProjectTownCore
import os

/// In-app updates from GitHub Releases: looks for a newer release once a day, and on request installs it in place.
/// Installing downloads the zip, checks its Ed25519 signature, unzips it, moves the running app to the Trash, puts
/// the new app at the same path and relaunches. A download made here gets no quarantine flag, so the ad-hoc signed
/// app starts without a Gatekeeper prompt.
@MainActor
final class Updater: ObservableObject {
    enum Status: Equatable {
        case idle
        case checking
        case upToDate
        case available(UpdateOffer)
        case installing
        case failed(String)
    }

    private enum UpdateError: Error {
        case badResponse
        case notWritable
        case badSignature
        case unexpectedApp
        case unzipFailed
    }

    private static let log = Logger(subsystem: "io.github.kevinyu1580.ProjectTown", category: "Updater")
    /// Public half of the key in the repository's UPDATE_SIGNING_KEY secret (scripts/update-signing.swift).
    private static let publicKey = "Ih5yrLUkWAt47Qkr2BlEddRcf5oYk3NUEtVtZ8IVBjE="
    private static let checkInterval: TimeInterval = 24 * 60 * 60

    private let latestReleaseURL: URL
    private let currentVersion: String
    @Published private(set) var status = Status.idle
    private var timer: Timer?

    init() {
        var latestReleaseURL = URL(string: "https://api.github.com/repos/KevinYu1580/ProjectTown/releases/latest")!
        var currentVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        #if DEBUG
        // Lets a local test serve its own release and pretend to be an older version; PROJECTTOWN_UPDATE_AUTO_INSTALL=1
        // then installs what it finds without a click. The relaunched app inherits these, so it updates again in a loop.
        let environment = ProcessInfo.processInfo.environment
        if let feed = environment["PROJECTTOWN_UPDATE_FEED"].flatMap(URL.init(string:)) { latestReleaseURL = feed }
        if let version = environment["PROJECTTOWN_UPDATE_CURRENT_VERSION"] { currentVersion = version }
        #endif
        self.latestReleaseURL = latestReleaseURL
        self.currentVersion = currentVersion
    }

    /// Checks now and then once a day while `enabled`; does nothing when already in that state.
    func setAutomaticChecks(_ enabled: Bool) {
        guard enabled != (timer != nil) else { return }
        timer?.invalidate()
        timer = nil
        guard enabled else { return }
        timer = Timer.scheduledTimer(withTimeInterval: Self.checkInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.check() }
        }
        Task { await check() }
    }

    /// A failed automatic check stays silent; one the user asked for shows why.
    func check(userInitiated: Bool = false) async {
        switch status {
        case .checking, .installing: return
        default: break
        }
        status = .checking
        do {
            if let offer = try await latestOffer() {
                Self.log.info("Update \(offer.version, privacy: .public) is available")
                status = .available(offer)
                #if DEBUG
                if ProcessInfo.processInfo.environment["PROJECTTOWN_UPDATE_AUTO_INSTALL"] == "1" { await install() }
                #endif
            } else {
                status = .upToDate
            }
        } catch {
            Self.log.error("Update check failed: \(String(describing: error), privacy: .public)")
            status = userInitiated ? .failed(String(localized: "Could not check for updates. Check your internet connection and try again.")) : .idle
        }
    }

    /// Asks for the latest release again first, so a release that came out since the last check is the one installed.
    func install() async {
        guard status != .installing else { return }
        status = .installing
        do {
            guard let offer = try await latestOffer() else {
                status = .upToDate
                return
            }
            let app = Bundle.main.bundleURL
            guard FileManager.default.isWritableFile(atPath: app.deletingLastPathComponent().path) else { throw UpdateError.notWritable }
            async let zipDownload = download(offer.zipURL)
            async let signatureDownload = download(offer.signatureURL)
            let (zip, signature) = try await (zipDownload, signatureDownload)
            guard UpdateSignature.isValid(signature, for: zip, publicKey: Self.publicKey) else { throw UpdateError.badSignature }

            // On the app's volume, so the final move is a rename.
            let folder = try FileManager.default.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: app, create: true)
            let zipFile = folder.appendingPathComponent("update.zip")
            try zip.write(to: zipFile)
            try await unzip(zipFile, into: folder)
            let newApp = folder.appendingPathComponent("ProjectTown.app")
            guard let bundle = Bundle(url: newApp),
                  bundle.bundleIdentifier == Bundle.main.bundleIdentifier,
                  bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String == offer.version else {
                throw UpdateError.unexpectedApp
            }

            var trashed: NSURL?
            try FileManager.default.trashItem(at: app, resultingItemURL: &trashed)
            do {
                try FileManager.default.moveItem(at: newApp, to: app)
            } catch {
                if let trashed = trashed as URL? { try? FileManager.default.moveItem(at: trashed, to: app) }
                throw error
            }
            try? FileManager.default.removeItem(at: folder)
            Self.log.info("Installed \(offer.version, privacy: .public), relaunching")
            try relaunch(app)
        } catch {
            Self.log.error("Update failed: \(String(describing: error), privacy: .public)")
            status = .failed(message(for: error))
        }
    }

    private func message(for error: Error) -> String {
        switch error as? UpdateError {
        case .notWritable:
            String(localized: "ProjectTown cannot replace itself in this folder. Download the update from the release page instead.")
        case .badSignature, .unexpectedApp:
            String(localized: "The downloaded update could not be verified, so it was not installed.")
        default:
            String(localized: "The update could not be installed. Check your internet connection and try again.")
        }
    }

    /// The latest release on GitHub, or nil when it is not newer than this app.
    private func latestOffer() async throws -> UpdateOffer? {
        var request = URLRequest(url: latestReleaseURL, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw UpdateError.badResponse }
        return try UpdateOffer.from(latestRelease: data, currentVersion: currentVersion)
    }

    private func download(_ url: URL) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw UpdateError.badResponse }
        return data
    }

    private func unzip(_ zip: URL, into folder: URL) async throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        process.arguments = ["-x", "-k", zip.path, folder.path]
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            process.terminationHandler = { process in
                if process.terminationStatus == 0 { continuation.resume() } else { continuation.resume(throwing: UpdateError.unzipFailed) }
            }
            do { try process.run() } catch { continuation.resume(throwing: error) }
        }
    }

    /// A shell waits for this process to exit, then opens the new app; quitting puts the user's wallpaper back first.
    private func relaunch(_ app: URL) throws {
        let shell = Process()
        shell.executableURL = URL(fileURLWithPath: "/bin/sh")
        shell.arguments = [
            "-c", #"while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; /usr/bin/open "$2""#,
            "sh", String(ProcessInfo.processInfo.processIdentifier), app.path,
        ]
        try shell.run()
        NSApp.terminate(nil)
    }
}
