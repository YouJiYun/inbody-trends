import SwiftUI
import UniformTypeIdentifiers

struct CSVDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.commaSeparatedText] }
    let text: String
    init(text: String) { self.text = text }
    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents, let text = String(data: data, encoding: .utf8) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        self.text = text
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}

struct ReportsView: View {
    @EnvironmentObject private var store: ReportStore
    @State private var export = false
    @State private var confirmExport = false
    @State private var confirmDeleteAll = false
    @State private var failure: String?
    var body: some View {
        List {
            if !store.archive.pending.isEmpty {
                Section("待识别 · 不会进入趋势") {
                    ForEach(store.archive.pending) { pending in
                        NavigationLink { PendingDetailView(pending: pending) } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Label("需要更清晰的照片", systemImage: "exclamationmark.viewfinder")
                                Text("导入于 \(pending.importedAt.formatted(date: .abbreviated, time: .shortened))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            Section("测量记录") {
                if store.sorted.isEmpty { Text("尚无可靠识别的测量记录").foregroundStyle(.secondary) }
                ForEach(store.sorted) { record in
                    NavigationLink { MeasurementDetailView(measurementID: record.id) } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(ReportDate.display(record.measuredAt)).font(.headline)
                            Text("\(record.metrics.count) 项指标 · \(record.kind == .complete ? "完整报告" : "报告内历史")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Section("本地数据与隐私") {
                Button("导出全部已识别指标（CSV）", systemImage: "square.and.arrow.up") { confirmExport = true }
                    .disabled(store.sorted.isEmpty || store.loadError != nil || store.isImporting)
                Button("删除全部记录和原图", systemImage: "trash", role: .destructive) { confirmDeleteAll = true }
                    .disabled(store.loadError != nil || store.isImporting)
                Text("无账号、无云 OCR。原图可能包含身份信息，使用 iOS 文件保护并排除系统备份。卸载应用可能丢失所有记录；请按需导出并妥善保管。")
                    .font(.caption).foregroundStyle(.secondary)
                Text("应用用于单人记录，不解析或保存报告 ID；请勿混入他人报告。CSV 仅包含已识别指标、测量时间和来源标识，不含原图或 OCR 全文。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.navigationTitle("报告")
            .confirmationDialog("导出文件包含健康数据；分享后不再受应用保护。确定导出？", isPresented: $confirmExport, titleVisibility: .visible) {
                Button("导出 CSV") { export = true }
            }
            .confirmationDialog("永久删除全部本地测量、待识别照片与原图？此操作无法撤销。", isPresented: $confirmDeleteAll, titleVisibility: .visible) {
                Button("删除全部", role: .destructive) {
                    do { try store.deleteAll() } catch { failure = error.localizedDescription }
                }
            }
            .fileExporter(isPresented: $export, document: CSVDocument(text: store.exportCSV()),
                          contentType: .commaSeparatedText, defaultFilename: "身体记录") { result in
                if case .failure(let error) = result { failure = error.localizedDescription }
            }
            .alert("本地数据操作失败", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("知道了", role: .cancel) { }
            } message: { Text(failure ?? "") }
    }
}

struct MeasurementDetailView: View {
    @EnvironmentObject private var store: ReportStore
    @Environment(\.dismiss) private var dismiss
    let measurementID: UUID
    @State private var confirmDelete = false
    @State private var photo: ImageReference?
    @State private var failure: String?
    private var record: Measurement? { store.archive.measurements.first { $0.id == measurementID } }
    var body: some View {
        List {
            if let record {
                Section {
                    Text(ReportDate.display(record.measuredAt)).font(.headline)
                    Text(record.kind == .complete ? "完整报告 · 核心数据已通过一致性校验" : "报告内历史 · 仅保存实际识别的核心指标")
                        .font(.caption).foregroundStyle(.secondary)
                    Text("测量时间按报告上的本地时间记录，未猜测时区。").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(Array(Set(MetricDefinition.all.filter { record.metrics[$0.id] != nil }.map(\.category))).sorted(), id: \.self) { category in
                    Section(category) {
                        ForEach(MetricDefinition.all.filter { $0.category == category && record.metrics[$0.id] != nil }) { definition in
                            if let value = record.metrics[definition.id] {
                                NavigationLink { MetricDetailView(definition: definition) } label: {
                                    HStack {
                                        Text(definition.name)
                                        Spacer()
                                        Text("\(definition.format(value.value)) \(definition.unit)").foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
                Section("原图与识别范围") {
                    ForEach(record.sourceIDs, id: \.self) { id in
                        if let source = store.source(for: id) {
                            Button("查看来源原图") { photo = ImageReference(url: store.imageURL(source.imageName)) }
                            Text("导入于 \(source.importedAt.formatted(date: .abbreviated, time: .shortened))").font(.caption)
                            ForEach(Array(source.issues.enumerated()), id: \.offset) { issue in
                                Text(issue.element).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section {
                    Button("删除这次测量", role: .destructive) { confirmDelete = true }.disabled(store.isImporting)
                    Text("原图只有在不再被任何测量引用时才会移除；同一报告的历史记录可能仍引用它。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else { Text("这次测量已删除") }
        }.navigationTitle("测量详情").navigationBarTitleDisplayMode(.inline)
            .sheet(item: $photo) { ImageViewer(reference: $0) }
            .confirmationDialog("永久删除这次测量？", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("删除", role: .destructive) {
                    do { try store.deleteMeasurement(measurementID); dismiss() } catch { failure = error.localizedDescription }
                }
            }
            .alert("删除失败", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("知道了", role: .cancel) { }
            } message: { Text(failure ?? "") }
    }
}

struct PendingDetailView: View {
    @EnvironmentObject private var store: ReportStore
    @Environment(\.dismiss) private var dismiss
    let pending: PendingScan
    @State private var photo: ImageReference?
    @State private var message: String?
    @State private var confirmDelete = false
    @State private var busy = false
    var body: some View {
        List {
            Section("待识别 · 无数值写入趋势") {
                Text(pending.reason).font(.callout)
                Text("建议返回扫描页重拍，或从相册导入清晰版本。无须手填。").font(.caption)
                Button("查看待识别原图") { photo = ImageReference(url: store.imageURL(pending.imageName)) }
                Button("重新尝试本地识别") {
                    Task {
                        busy = true
                        defer { busy = false }
                        do {
                            let data = try Data(contentsOf: store.imageURL(pending.imageName))
                            _ = try await store.importImage(data, retryID: pending.id)
                            dismiss()
                        } catch { message = error.localizedDescription }
                    }
                }.disabled(busy || store.isImporting || store.loadError != nil)
                if busy { ProgressView("正在识别…") }
            }
            Button("删除待识别照片", role: .destructive) { confirmDelete = true }
                .disabled(busy || store.isImporting)
        }.navigationTitle("待识别")
            .sheet(item: $photo) { ImageViewer(reference: $0) }
            .confirmationDialog("永久删除待识别原图？", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("删除", role: .destructive) {
                    do { try store.deletePending(pending.id); dismiss() } catch { message = error.localizedDescription }
                }
            }
            .alert("操作未完成", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("知道了", role: .cancel) { }
            } message: { Text(message ?? "") }
    }
}

struct ImageReference: Identifiable {
    let id = UUID()
    let url: URL
}

struct ImageViewer: View {
    let reference: ImageReference
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView([.horizontal, .vertical]) {
                    if let image = UIImage(contentsOfFile: reference.url.path) {
                        Image(uiImage: image).resizable().scaledToFit()
                            .frame(width: max(geometry.size.width, 900))
                            .accessibilityLabel("报告原图，可能包含个人信息")
                    } else {
                        ContentUnavailableView("原图无法读取", systemImage: "photo",
                                               description: Text("文件可能被移除或设备暂时锁定。"))
                    }
                }
            }.navigationTitle("本地原图").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
    }
}
