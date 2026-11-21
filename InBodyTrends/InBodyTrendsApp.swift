import SwiftUI

@main
struct InBodyTrendsApp: App {
    @StateObject private var store = ReportStore()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .tint(Theme.teal)
                .environment(\.calendar, ReportDate.calendar)
                .environment(\.timeZone, ReportDate.calendar.timeZone)
                .overlay {
                    if scenePhase != .active {
                        Theme.background.ignoresSafeArea()
                            .overlay { Label("身体记录 · 本地保护", systemImage: "lock.shield").font(.title2) }
                    }
                }
        }
    }
}
