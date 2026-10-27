import ProjectTownCore
import SwiftUI

struct StatusTab: View {
    @ObservedObject var store: SettingsStore

    var body: some View {
        Form {
            Section(String(localized: "Session states")) {
                IntField(store: store, title: String(localized: "“Just finished” lasts"), unit: String(localized: "min"),
                         value: store.config.finishedWindowMinutes) { $0.finishedWindowMinutes = $1 }
                IntField(store: store, title: String(localized: "Sleeping after"), unit: String(localized: "min"),
                         value: store.config.sleepThresholdMinutes) { $0.sleepThresholdMinutes = $1 }
                Text(String(localized: "A session falls asleep after being idle this long. It must be longer than the “Just finished” duration."))
                    .font(.caption).foregroundStyle(.secondary)
                Toggle(String(localized: "Hide session names"), isOn: Binding(
                    get: { store.config.hideSessionNames },
                    set: { value in store.update { $0.hideSessionNames = value } }
                ))
            }
        }
        .formStyle(.grouped)
    }
}
