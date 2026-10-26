import AppKit
import ProjectTownCore
import SwiftUI

struct SettingsView: View {
    @ObservedObject var store: SettingsStore
    @ObservedObject var wallpaper: WallpaperWindowController

    var body: some View {
        VStack(spacing: 0) {
            if let notice = store.notice {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.yellow)
                    Text(notice).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button(String(localized: "Dismiss")) { store.dismissNotice() }
                }
                .padding(10)
                .background(.yellow.opacity(0.15))
            }
            TabView {
                ProjectsTab(store: store)
                    .tabItem { Label(String(localized: "Projects"), systemImage: "folder") }
                AppearanceTab(store: store, wallpaper: wallpaper)
                    .tabItem { Label(String(localized: "Appearance"), systemImage: "paintbrush") }
                StatusTab(store: store)
                    .tabItem { Label(String(localized: "Status"), systemImage: "waveform.path.ecg") }
                GeneralTab(wallpaper: wallpaper)
                    .tabItem { Label(String(localized: "General"), systemImage: "gearshape") }
            }
        }
        .frame(width: 640, height: 480)
    }
}

/// Whole-number text field. The value is applied on Return or when focus leaves the field; a rejected value shows
/// the reason below the field and the stored value stays unchanged.
struct IntField: View {
    @ObservedObject var store: SettingsStore
    let title: String
    let unit: String
    let value: Int
    let apply: (inout AppConfig, Int) -> Void

    @State private var text = ""
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            LabeledContent(title) {
                HStack(spacing: 4) {
                    TextField("", text: $text)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 70)
                        .focused($focused)
                        .onSubmit { commit() }
                    Text(unit).foregroundStyle(.secondary)
                }
            }
            if let error {
                Text(error).font(.caption).foregroundStyle(.red).multilineTextAlignment(.trailing)
            }
        }
        .onAppear { text = String(value) }
        .onChange(of: value) { _, new in if !focused { text = String(new) } }
        .onChange(of: text) { _, _ in if focused { error = nil } }
        .onChange(of: focused) { _, isFocused in
            if !isFocused {
                commit()
                if error != nil { text = String(value) }  // never leave a rejected value on screen
            }
        }
    }

    private func commit() {
        guard let number = Int(text.trimmingCharacters(in: .whitespaces)) else {
            error = String(localized: "Enter a whole number.")
            return
        }
        let outcome = store.update { apply(&$0, number) }
        error = outcome.message
        if outcome == .applied { text = String(number) }
    }
}

extension Color {
    /// `#RRGGBB`; falls back to gray for anything else.
    init(hex: String) {
        var digits = hex
        if digits.hasPrefix("#") { digits.removeFirst() }
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else {
            self = .gray
            return
        }
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }

    var hexString: String {
        let c = NSColor(self).usingColorSpace(.sRGB) ?? .gray
        func byte(_ v: CGFloat) -> Int { Int((min(max(v, 0), 1) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", byte(c.redComponent), byte(c.greenComponent), byte(c.blueComponent))
    }
}
