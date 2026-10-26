import AppKit
import ProjectTownCore
import SwiftUI

struct AppearanceTab: View {
    @ObservedObject var store: SettingsStore
    @ObservedObject var wallpaper: WallpaperWindowController
    @State private var timeError: String?

    private var config: AppConfig { store.config }

    var body: some View {
        Form {
            Section(String(localized: "Day and night")) {
                Picker(String(localized: "Mode"), selection: Binding(
                    get: { config.dayNight.mode },
                    set: { mode in store.update { $0.dayNight.mode = mode } }
                )) {
                    Text(String(localized: "Real time")).tag(DayNightMode.realtime)
                    Text(String(localized: "Fixed cycle")).tag(DayNightMode.cycle)
                }
                .pickerStyle(.segmented)

                switch config.dayNight.mode {
                case .realtime:
                    timePicker(String(localized: "Sunrise"), value: config.dayNight.sunrise) { $0.dayNight.sunrise = $1 }
                    timePicker(String(localized: "Sunset"), value: config.dayNight.sunset) { $0.dayNight.sunset = $1 }
                    if let timeError { Text(timeError).font(.caption).foregroundStyle(.red) }
                case .cycle:
                    IntField(store: store, title: String(localized: "Cycle length"), unit: String(localized: "min"),
                             value: config.dayNight.cyclePeriodMinutes) { $0.dayNight.cyclePeriodMinutes = $1 }
                    LabeledContent(String(localized: "Daytime share")) {
                        HStack {
                            Slider(value: Binding(
                                get: { (config.dayNight.dayRatio * 100).rounded() },
                                set: { percent in store.update { $0.dayNight.dayRatio = percent / 100 } }
                            ), in: ConfigLimits.dayRatio.lowerBound * 100...ConfigLimits.dayRatio.upperBound * 100, step: 1)
                            .frame(width: 180)
                            Text("\(Int((config.dayNight.dayRatio * 100).rounded()))%")
                                .monospacedDigit()
                                .frame(width: 40, alignment: .trailing)
                        }
                    }
                }
            }

            Section(String(localized: "Camera")) {
                Picker(String(localized: "Mode"), selection: Binding(
                    get: { config.camera.mode },
                    set: { mode in store.update { $0.camera.mode = mode } }
                )) {
                    Text(String(localized: "Fixed")).tag(CameraMode.fixed)
                    Text(String(localized: "Rotate on a timer")).tag(CameraMode.interval)
                    Text(String(localized: "Rotate slowly")).tag(CameraMode.continuous)
                }
                switch config.camera.mode {
                case .fixed:
                    EmptyView()
                case .interval:
                    IntField(store: store, title: String(localized: "Turn every"), unit: String(localized: "min"),
                             value: config.camera.intervalMinutes) { $0.camera.intervalMinutes = $1 }
                case .continuous:
                    IntField(store: store, title: String(localized: "One rotation takes"), unit: String(localized: "min"),
                             value: config.camera.continuousPeriodMinutes) { $0.camera.continuousPeriodMinutes = $1 }
                }
                LabeledContent(String(localized: "View")) {
                    HStack {
                        Button(String(localized: "Adjust View…")) { wallpaper.enterCameraEdit() }
                        Button(String(localized: "Reset View")) { store.update { $0.camera.base = CameraBase() } }
                    }
                }
            }

            Section(String(localized: "Display")) {
                Toggle(String(localized: "Tilt-shift blur"), isOn: Binding(
                    get: { config.depthOfField }, set: { value in store.update { $0.depthOfField = value } }
                ))
                Toggle(String(localized: "Show HUD"), isOn: Binding(
                    get: { config.hudVisible }, set: { value in store.update { $0.hudVisible = value } }
                ))
                DisplayPicker(store: store)
                LabeledContent(String(localized: "FPS")) {
                    VStack(alignment: .trailing, spacing: 2) {
                        FPSPicker(options: ConfigLimits.fps, disabled: DisplaySupport.unsupportedFPS, selection: config.fps) { fps in
                            store.update { $0.fps = fps }
                        }
                        .frame(width: 220)
                        if !DisplaySupport.unsupportedFPS.isEmpty {
                            Text(String(localized: "120: Not supported on this display or system"))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    /// Hour-and-minute picker stored as "HH:mm". A rejected time (sunset not after sunrise) shows below and snaps back.
    private func timePicker(_ title: String, value: String, set: @escaping (inout AppConfig, String) -> Void) -> some View {
        DatePicker(title, selection: Binding(
            get: { Self.date(from: value) },
            set: { date in
                timeError = store.update { set(&$0, Self.string(from: date)) }.message
            }
        ), displayedComponents: .hourAndMinute)
    }

    private static func date(from hhmm: String) -> Date {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return Date() }
        return Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: Date()) ?? Date()
    }

    private static func string(from date: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}

/// Display choice by UUID. A display that is no longer connected falls back to the primary one, as the window does.
private struct DisplayPicker: View {
    @ObservedObject var store: SettingsStore
    @State private var screens = NSScreen.screens

    private var options: [(uuid: String, name: String)] {
        let named = screens.compactMap { screen in Displays.uuid(of: screen).map { ($0, screen.localizedName) } }
        return named.enumerated().map { index, entry in
            let duplicates = named.filter { $0.1 == entry.1 }.count > 1
            return (entry.0, duplicates ? "\(entry.1) (\(index + 1))" : entry.1)
        }
    }

    var body: some View {
        Picker(String(localized: "Display"), selection: Binding(
            get: { Displays.screen(for: store.config.displayUUID).flatMap(Displays.uuid(of:)) ?? "" },
            set: { uuid in store.update { $0.displayUUID = uuid } }
        )) {
            ForEach(options, id: \.uuid) { Text($0.name).tag($0.uuid) }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)) { _ in
            screens = NSScreen.screens
        }
    }
}

/// `NSSegmentedControl` because SwiftUI's segmented picker cannot disable a single segment.
private struct FPSPicker: NSViewRepresentable {
    let options: [Int]
    let disabled: Set<Int>
    let selection: Int
    let onSelect: (Int) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSSegmentedControl {
        NSSegmentedControl(
            labels: options.map(String.init), trackingMode: .selectOne,
            target: context.coordinator, action: #selector(Coordinator.changed(_:))
        )
    }

    func updateNSView(_ control: NSSegmentedControl, context: Context) {
        context.coordinator.parent = self
        for (index, fps) in options.enumerated() {
            control.setEnabled(!disabled.contains(fps), forSegment: index)
        }
        control.selectedSegment = options.firstIndex(of: selection) ?? -1
    }

    @MainActor
    final class Coordinator: NSObject {
        var parent: FPSPicker
        init(_ parent: FPSPicker) { self.parent = parent }

        @objc func changed(_ sender: NSSegmentedControl) {
            let index = sender.selectedSegment
            guard parent.options.indices.contains(index) else { return }
            parent.onSelect(parent.options[index])
        }
    }
}
