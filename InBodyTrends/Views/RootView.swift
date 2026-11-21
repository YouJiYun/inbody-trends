import SwiftUI
import Charts

enum Theme {
    static let teal = Color(red: 0.09, green: 0.52, blue: 0.45)
    static let background = Color(uiColor: .systemGroupedBackground)
}

struct RootView: View {
    @EnvironmentObject private var store: ReportStore
    @State private var tab = 0
    var body: some View {
        TabView(selection: $tab) {
            NavigationStack { OverviewView { tab = 1 } }
                .tabItem { Label("概览", systemImage: "square.grid.2x2") }.tag(0)
            NavigationStack { ScanView() }
                .tabItem { Label("扫描", systemImage: "viewfinder") }.tag(1)
            NavigationStack { MetricsView() }
                .tabItem { Label("趋势", systemImage: "chart.xyaxis.line") }.tag(2)
            NavigationStack { ReportsView() }
                .tabItem { Label("报告", systemImage: "doc.text") }.tag(3)
        }
        .safeAreaInset(edge: .top) {
            if let error = store.loadError {
                Text(error).font(.callout).padding().background(.red.opacity(0.15))
                    .accessibilityLabel("本地存储错误，\(error)")
            }
        }
    }
}

struct Card<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20).background(Color(uiColor: .secondarySystemGroupedBackground),
                                     in: RoundedRectangle(cornerRadius: 22))
    }
}

struct OverviewView: View {
    @EnvironmentObject private var store: ReportStore
    let scan: () -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("看见每一点变化").font(.largeTitle.bold()).padding(.top, 8)
                if let latest = store.sorted.first {
                    Text("最近一次 · \(ReportDate.display(latest.measuredAt))").font(.subheadline).foregroundStyle(.secondary)
                    ForEach(["weight", "muscle", "pbf"], id: \.self) { key in
                        if let definition = MetricDefinition.find(key), let value = latest.metrics[key] {
                            NavigationLink { MetricDetailView(definition: definition) } label: {
                                Card {
                                    HStack {
                                        Text(definition.name).font(.headline)
                                        Spacer()
                                        Image(systemName: "chevron.right").foregroundStyle(.secondary)
                                    }
                                    HStack(alignment: .firstTextBaseline) {
                                        Text(definition.format(value.value)).font(.system(.largeTitle, design: .rounded).bold())
                                        Text(definition.unit).foregroundStyle(.secondary)
                                    }
                                    Text(delta(key: key, current: latest, definition: definition))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }.buttonStyle(.plain)
                        }
                    }
                    if latest.kind == .history {
                        Label("本次仅来自报告内历史，其他指标暂无数据", systemImage: "info.circle").font(.callout)
                    }
                } else {
                    ContentUnavailableView("从第一张报告开始", systemImage: "doc.viewfinder",
                                           description: Text("拍下中文 InBody 报告，自动提取数据。\n没有手填表格，也没有云识别。"))
                }
                Button(action: scan) {
                    Label("扫描新报告", systemImage: "plus").frame(maxWidth: .infinity).padding(8)
                }.buttonStyle(.borderedProminent).controlSize(.large)
                Card {
                    Label("记录，而不是评判", systemImage: "leaf").font(.headline)
                    Text("尽量在相同时间、状态与设备下测量。饮水、运动与进食可能影响结果，变化不代表好坏。")
                        .font(.callout).foregroundStyle(.secondary)
                    Text("本应用不是医疗设备，不提供诊断或饮食处方。").font(.caption).foregroundStyle(.secondary)
                }
            }.padding()
        }.background(Theme.background).navigationTitle("身体记录").navigationBarTitleDisplayMode(.inline)
    }
    private func delta(key: String, current: Measurement, definition: MetricDefinition) -> String {
        guard let previous = store.points(for: key).last(where: { $0.measuredAt < current.measuredAt }),
              let old = previous.metrics[key], let value = current.metrics[key] else { return "首次记录 · 暂无历史差异" }
        let change = value.value - old.value
        return "比上次 \(change > 0 ? "+" : "")\(definition.format(change)) \(key == "pbf" ? "个百分点" : definition.unit)"
    }
}

struct MetricsView: View {
    @EnvironmentObject private var store: ReportStore
    @State private var search = ""
    private var visible: [MetricDefinition] {
        store.availableMetrics.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) ||
            $0.category.localizedCaseInsensitiveContains(search) }
    }
    var body: some View {
        Group {
            if store.availableMetrics.isEmpty {
                ContentUnavailableView("尚无趋势", systemImage: "chart.xyaxis.line",
                                       description: Text("导入第一张报告后，每个已识别指标都会出现在这里。"))
            } else {
                List {
                    ForEach(Array(Set(visible.map(\.category))).sorted(), id: \.self) { category in
                        Section(category) {
                            ForEach(visible.filter { $0.category == category }) { definition in
                                NavigationLink { MetricDetailView(definition: definition) } label: {
                                    HStack {
                                        Text(definition.name)
                                        Spacer()
                                        if let value = store.points(for: definition.id).last?.metrics[definition.id] {
                                            Text("\(definition.format(value.value)) \(definition.unit)").foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }.searchable(text: $search, prompt: "搜索任意已识别指标")
            }
        }.navigationTitle("历史趋势")
    }
}

enum TrendWindow: String, CaseIterable, Identifiable {
    case quarter = "3 个月", year = "1 年", all = "全部"
    var id: String { rawValue }
    var months: Int? {
        switch self { case .quarter: return 3; case .year: return 12; case .all: return nil }
    }
}

struct MetricDetailView: View {
    @EnvironmentObject private var store: ReportStore
    let definition: MetricDefinition
    @State private var window: TrendWindow = .all
    @State private var selectedDate: Date?
    private var records: [Measurement] {
        let all = store.points(for: definition.id)
        guard let months = window.months, let end = all.last?.measuredAt,
              let start = ReportDate.calendar.date(byAdding: .month, value: -months, to: end) else { return all }
        return all.filter { $0.measuredAt >= start }
    }
    private var selected: Measurement? {
        if let selectedDate {
            return records.min { abs($0.measuredAt.timeIntervalSince(selectedDate)) < abs($1.measuredAt.timeIntervalSince(selectedDate)) }
        }
        return records.last
    }
    private var yDomain: ClosedRange<Double> {
        let values = records.compactMap { $0.metrics[definition.id]?.value }
        let low = values.min() ?? 0
        let high = values.max() ?? 1
        let padding = max((high - low) * 0.2, max(abs(high) * 0.02, 0.1))
        return (low - padding)...(high + padding)
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Picker("时间范围", selection: $window) {
                    ForEach(TrendWindow.allCases) { Text($0.rawValue).tag($0) }
                }.pickerStyle(.segmented).onChange(of: window) { _, _ in selectedDate = nil }
                Text("时间窗口以最近一次测量为终点").font(.caption).foregroundStyle(.secondary)
                if let selected, let value = selected.metrics[definition.id] {
                    Card {
                        Text("\(definition.format(value.value)) \(definition.unit)").font(.largeTitle.bold())
                        Text(ReportDate.display(selected.measuredAt)).font(.subheadline).foregroundStyle(.secondary)
                        Text(selected.kind == .complete ? "完整报告" : "报告内历史 · 部分指标").font(.caption)
                        Chart {
                            ForEach(records) { record in
                                if let value = record.metrics[definition.id]?.value {
                                    if records.count > 1 {
                                        LineMark(x: .value("测量时间", record.measuredAt), y: .value(definition.name, value))
                                            .foregroundStyle(Theme.teal)
                                    }
                                    PointMark(x: .value("测量时间", record.measuredAt), y: .value(definition.name, value))
                                        .foregroundStyle(Theme.teal)
                                        .accessibilityLabel(ReportDate.display(record.measuredAt))
                                        .accessibilityValue("\(definition.format(value)) \(definition.unit)")
                                }
                            }
                            if selectedDate != nil {
                                RuleMark(x: .value("选中测量", selected.measuredAt)).foregroundStyle(.secondary)
                            }
                        }
                        .chartYScale(domain: yDomain)
                        .chartXSelection(value: $selectedDate)
                        .frame(height: 230)
                        NavigationLink("查看选中测量及原图") { MeasurementDetailView(measurementID: selected.id) }
                        if records.count == 1 { Text("仅一次测量，尚不能形成趋势。").font(.caption).foregroundStyle(.secondary) }
                    }
                } else {
                    ContentUnavailableView("此指标暂无记录", systemImage: "chart.xyaxis.line")
                }
                Text(definition.explanation).font(.callout).foregroundStyle(.secondary)
                Text("每次测量").font(.title3.bold())
                ForEach(records.reversed()) { record in
                    NavigationLink { MeasurementDetailView(measurementID: record.id) } label: {
                        Card {
                            Text(ReportDate.display(record.measuredAt)).font(.headline)
                            if let value = record.metrics[definition.id] {
                                Text("\(definition.format(value.value)) \(definition.unit)")
                            }
                            Text(record.kind == .complete ? "完整报告" : "报告内历史").font(.caption).foregroundStyle(.secondary)
                        }
                    }.buttonStyle(.plain)
                }
            }.padding()
        }.background(Theme.background).navigationTitle(definition.name).navigationBarTitleDisplayMode(.inline)
    }
}
