import AppKit
import ServiceManagement
import SwiftUI
import os

struct GeneralTab: View {
    private static let log = Logger(subsystem: "io.github.kevinyu1580.ProjectTown", category: "GeneralTab")
    private static let repositoryURL = URL(string: "https://github.com/KevinYu1580/ProjectTown")!

    @ObservedObject var wallpaper: WallpaperWindowController
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
                LabeledContent(String(localized: "Version")) { Text(version) }
                LabeledContent(String(localized: "GitHub")) { Link(Self.repositoryURL.absoluteString, destination: Self.repositoryURL) }
            }
        }
        .formStyle(.grouped)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            loginStatus = SMAppService.mainApp.status  // the user may have changed it in System Settings
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
