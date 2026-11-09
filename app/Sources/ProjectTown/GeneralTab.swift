import AppKit
import ServiceManagement
import SwiftUI
import os

struct GeneralTab: View {
    private static let log = Logger(subsystem: "io.github.kevinyu1580.ProjectTown", category: "GeneralTab")
    private static let repositoryURL = URL(string: "https://github.com/KevinYu1580/ProjectTown")!
    private static let releasesURL = URL(string: "https://github.com/KevinYu1580/ProjectTown/releases/latest")!

    @ObservedObject var store: SettingsStore
    @ObservedObject var wallpaper: WallpaperWindowController
    @ObservedObject var updater: Updater
    // Never stored: the login item's state lives in the system, so it is re-read from `.status`.
    @State private var loginStatus = SMAppService.mainApp.status
    @State private var loginError: String?

    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
    }

    var body: some View {
        Form {
            Section {
                Toggle(String(localized: "Launch at login"), isOn: Binding(
                    get: { loginStatus == .enabled || loginStatus == .requiresApproval },
                    set: { setLaunchAtLogin($0) }
                ))
                if loginStatus == .requiresApproval {
                    HStack {
                        Text(String(localized: "Allow ProjectTown in System Settings to finish turning this on."))
                            .font(.caption).foregroundStyle(.orange)
                        Button(String(localized: "Open Login Items")) { SMAppService.openSystemSettingsLoginItems() }
                    }
                }
                if let loginError { Text(loginError).font(.caption).foregroundStyle(.red) }

                Toggle(String(localized: "Pause rendering"), isOn: Binding(
                    get: { wallpaper.userPaused },
                    set: { wallpaper.setUserPaused($0) }
                ))
            }
            Section {
                Toggle(String(localized: "Check for updates automatically"), isOn: Binding(
                    get: { store.config.checkForUpdates }, set: { value in store.update { $0.checkForUpdates = value } }
                ))
                updateRow
            }
            Section {
                Text(String(localized: "ProjectTown is free and open source. If you enjoy your little town, you can buy me a coffee on Ko-fi to keep it growing."))
                    .fixedSize(horizontal: false, vertical: true)
                Link(String(localized: "Support on Ko-fi"), destination: Support.url)
            }
            Section {
                LabeledContent(String(localized: "Version")) { Text(version) }
                LabeledContent(String(localized: "GitHub")) { Link(Self.repositoryURL.absoluteString, destination: Self.repositoryURL) }
            }
        }
        .formStyle(.grouped)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            loginStatus = SMAppService.mainApp.status  // the user may have changed it in System Settings
        }
    }

    @ViewBuilder private var updateRow: some View {
        switch updater.status {
        case .idle, .upToDate, .failed:
            HStack {
                switch updater.status {
                case .upToDate: Text(String(localized: "ProjectTown is up to date.")).foregroundStyle(.secondary)
                case .failed(let message):
                    Text(message).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                    Link(String(localized: "Releases"), destination: Self.releasesURL).font(.caption)
                default: EmptyView()
                }
                Spacer()
                Button(String(localized: "Check Now")) { Task { await updater.check(userInitiated: true) } }
            }
        case .checking:
            HStack {
                ProgressView().controlSize(.small)
                Text(String(localized: "Checking for updates…")).foregroundStyle(.secondary)
            }
        case .available(let offer):
            HStack {
                Text(String(localized: "Version \(offer.version) is available."))
                Link(String(localized: "What’s new"), destination: offer.pageURL)
                Spacer()
                Button(String(localized: "Update and Restart")) { Task { await updater.install() } }
            }
        case .installing:
            HStack {
                ProgressView().controlSize(.small)
                Text(String(localized: "Downloading and installing the update…")).foregroundStyle(.secondary)
            }
        }
    }

    private func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginError = nil
        } catch {
            Self.log.error("Launch at login change failed: \(error.localizedDescription, privacy: .public)")
            loginError = String(localized: "Could not change launch at login: \(error.localizedDescription)")
        }
        loginStatus = SMAppService.mainApp.status
    }
}
