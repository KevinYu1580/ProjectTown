import AppKit
import ProjectTownCore
import SwiftUI

extension BuildingStyle {
    var displayName: String {
        switch self {
        case .office: String(localized: "Office")
        case .factory: String(localized: "Factory")
        case .cafe: String(localized: "Cafe")
        case .bookstore: String(localized: "Bookstore")
        case .lab: String(localized: "Lab")
        case .warehouse: String(localized: "Warehouse")
        case .radioTower: String(localized: "Radio Tower")
        case .greenhouse: String(localized: "Greenhouse")
        case .clockTower: String(localized: "Clock Tower")
        case .ramenShop: String(localized: "Ramen Shop")
        }
    }
}

private func styleName(_ key: String) -> String {
    BuildingStyle(rawValue: key)?.displayName ?? String(localized: "Auto")
}

private func folderExists(_ path: String) -> Bool {
    var isDirectory: ObjCBool = false
    let expanded = (path as NSString).expandingTildeInPath
    return FileManager.default.fileExists(atPath: expanded, isDirectory: &isDirectory) && isDirectory.boolValue
}

struct ProjectsTab: View {
    @ObservedObject var store: SettingsStore
    /// Projects are selected by path, which is unique across the list (duplicates are never added).
    @State private var selection: String?
    @State private var message: String?
    /// Bumped whenever a window becomes key, so rows re-check their folders after the user comes back from Finder.
    @State private var folderCheck = 0

    var body: some View {
        VStack(spacing: 8) {
            List(selection: $selection) {
                ForEach(store.config.projects, id: \.path) { ProjectRow(project: $0, folderCheck: folderCheck) }
                    .onMove { from, to in store.update { $0.projects.move(fromOffsets: from, toOffset: to) } }
            }
            .overlay {
                if store.config.projects.isEmpty {
                    Text(String(localized: "No projects yet. Click + to add a folder."))
                        .foregroundStyle(.secondary)
                }
            }

            HStack {
                Button { addProjects() } label: { Image(systemName: "plus") }
                    .help(String(localized: "Add projects"))
                Button { removeSelected() } label: { Image(systemName: "minus") }
                    .help(String(localized: "Remove the selected project"))
                    .disabled(selection == nil)
                if let message {
                    Text(message).font(.caption).foregroundStyle(.orange).lineLimit(2)
                }
                Spacer()
            }

            if let path = selection, let project = store.config.projects.first(where: { $0.path == path }) {
                ProjectEditor(store: store, project: project).id(path)
            }
        }
        .padding()
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { _ in folderCheck += 1 }
    }

    private func addProjects() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = true
        panel.prompt = String(localized: "Add")
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK else { return }
        let result = ProjectConfig.adding(paths: panel.urls.map(\.path), to: store.config.projects)
        let outcome = store.update { $0.projects = result.projects }
        if let failure = outcome.message {
            message = failure
        } else if result.duplicates.isEmpty {
            message = nil
        } else {
            let names = result.duplicates.map { URL(fileURLWithPath: $0).lastPathComponent }.joined(separator: ", ")
            message = String(localized: "Already added: \(names)")
        }
    }

    private func removeSelected() {
        guard let path = selection else { return }
        store.update { $0.projects.removeAll { $0.path == path } }
        selection = nil
        message = nil
    }
}

private struct ProjectRow: View {
    let project: ProjectConfig
    /// Not read; a changed value makes SwiftUI re-run `body` and with it the folder check.
    let folderCheck: Int

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(Color(hex: project.color)).frame(width: 12, height: 12)
            Text(project.name).lineLimit(1)
            Text(project.path)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 8)
            if !folderExists(project.path) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.yellow)
                    .help(String(localized: "This folder no longer exists."))
            }
            Text(styleName(project.buildingStyle)).foregroundStyle(.secondary)
        }
    }
}

private struct ProjectEditor: View {
    @ObservedObject var store: SettingsStore
    /// Current values of the edited project; the view is re-created per selection (`.id(path)`).
    let project: ProjectConfig

    @State private var name: String
    @State private var nameError: String?
    @FocusState private var nameFocused: Bool

    init(store: SettingsStore, project: ProjectConfig) {
        self.store = store
        self.project = project
        _name = State(initialValue: project.name)
    }

    /// Looks the project up by path at change time, so a reorder while selected cannot hit the wrong row.
    private func edit(_ change: @escaping (inout ProjectConfig) -> Void) {
        let path = project.path
        store.update { config in
            if let i = config.projects.firstIndex(where: { $0.path == path }) { change(&config.projects[i]) }
        }
    }

    var body: some View {
        Form {
            VStack(alignment: .leading, spacing: 2) {
                TextField(String(localized: "Name"), text: $name)
                    .focused($nameFocused)
                    .onSubmit { commitName() }
                    .onChange(of: nameFocused) { _, focused in if !focused { commitName() } }
                if let nameError { Text(nameError).font(.caption).foregroundStyle(.red) }
            }
            LabeledContent(String(localized: "Color")) {
                HStack(spacing: 6) {
                    ForEach(ProjectPalette.colors, id: \.self) { hex in swatch(hex) }
                    ColorPicker("", selection: Binding(
                        get: { Color(hex: project.color) },
                        set: { setColor($0.hexString) }
                    ), supportsOpacity: false)
                    .labelsHidden()
                }
            }
            Picker(String(localized: "Building style"), selection: Binding(
                get: { project.buildingStyle },
                set: { style in edit { $0.buildingStyle = style } }
            )) {
                Text(String(localized: "Auto")).tag("auto")
                ForEach(BuildingStyle.allCases, id: \.rawValue) { Text($0.displayName).tag($0.rawValue) }
            }
        }
        .formStyle(.grouped)
        .frame(height: 150)
    }

    private func swatch(_ hex: String) -> some View {
        Button { setColor(hex) } label: {
            Circle()
                .fill(Color(hex: hex))
                .frame(width: 16, height: 16)
                .overlay(Circle().stroke(Color.primary, lineWidth: project.color.uppercased() == hex ? 2 : 0))
        }
        .buttonStyle(.plain)
    }

    private func setColor(_ hex: String) {
        edit { $0.color = hex }
    }

    private func commitName() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            nameError = String(localized: "The name cannot be empty.")
            if !nameFocused { name = project.name }
            return
        }
        nameError = nil
        name = trimmed
        edit { $0.name = trimmed }
    }
}
