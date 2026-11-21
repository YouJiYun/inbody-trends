import Foundation
import CryptoKit
import SwiftUI

@MainActor
final class ReportStore: ObservableObject {
    @Published private(set) var archive = Archive()
    @Published private(set) var loadError: String?
    @Published private(set) var isImporting = false
    private let root: URL
    private let manager = FileManager.default
    private var indexURL: URL { root.appendingPathComponent("archive.json") }

    init() {
        root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("BodyRecords", isDirectory: true)
        do {
            try manager.createDirectory(at: root, withIntermediateDirectories: true,
                                        attributes: [.protectionKey: FileProtectionType.complete])
            var protectedRoot = root
            var resources = URLResourceValues()
            resources.isExcludedFromBackup = true
            try protectedRoot.setResourceValues(resources)
            if manager.fileExists(atPath: indexURL.path) {
                let decoded = try JSONDecoder().decode(Archive.self, from: Data(contentsOf: indexURL))
                guard decoded.schemaVersion == 1 else { throw RecordError.unsupportedArchive }
                archive = decoded
            }
        } catch { loadError = "无法读取本地数据：\(error.localizedDescription)。为避免覆盖，导入与删除已暂停。" }
    }
    var sorted: [Measurement] { archive.measurements.sorted { $0.measuredAt > $1.measuredAt } }
    var availableMetrics: [MetricDefinition] {
        MetricDefinition.all.filter { definition in
            archive.measurements.contains { $0.metrics[definition.id] != nil }
        }
    }
    func points(for key: String) -> [Measurement] {
        archive.measurements.filter { $0.metrics[key] != nil }.sorted { $0.measuredAt < $1.measuredAt }
    }
    func imageURL(_ name: String) -> URL { root.appendingPathComponent(name) }
    func source(for id: UUID) -> ReportSource? { archive.sources.first { $0.id == id } }

    func importImage(_ data: Data, retryID: UUID? = nil) async throws -> String {
        guard loadError == nil else { throw RecordError.storage("本地存储无法读取，未保存或覆盖数据。") }
        guard !isImporting else { throw RecordError.recognition("已有照片正在识别") }
        isImporting = true
        defer { isImporting = false }
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        if archive.sources.contains(where: { $0.digest == digest }) {
            if let retryID { try deletePending(retryID) }
            return "这张照片已导入，没有新增重复记录。"
        }
        let sourceID = UUID()
        let parsed: ParsedReport
        do {
            let document = try await LocalOCR.recognize(data)
            parsed = try ReportParser(document: document).parse(sourceID: sourceID)
        } catch {
            if retryID == nil { try retainPending(data: data, reason: error.localizedDescription) }
            throw error
        }
        var next = archive
        let before = next.measurements.count
        // Validate the whole merge before writing a source image or modifying the archive.
        do {
            next.measurements = try MeasurementMerge.merge([parsed.current] + parsed.history, into: next.measurements)
        } catch {
            if retryID == nil { try retainPending(data: data, reason: error.localizedDescription) }
            throw error
        }
        let imageName = "\(sourceID.uuidString).image"
        next.sources.append(ReportSource(id: sourceID, importedAt: Date(), imageName: imageName,
                                         digest: digest, issues: parsed.issues))
        if let retryID { next.pending.removeAll { $0.id == retryID } }
        try commit(next, newImage: (imageName, data))
        let added = next.measurements.count - before
        return added == 0 ? "同次测量已合并，没有重复时间点。" : "已自动保存，新增 \(added) 次测量。未识别项目请在报告详情查看。"
    }
    private func retainPending(data: Data, reason: String) throws {
        let id = UUID()
        let imageName = "\(id.uuidString).image"
        var next = archive
        next.pending.append(PendingScan(id: id, importedAt: Date(), imageName: imageName, reason: reason))
        try commit(next, newImage: (imageName, data))
    }
    func deleteMeasurement(_ id: UUID) throws {
        var next = archive
        next.measurements.removeAll { $0.id == id }
        let active = Set(next.measurements.flatMap(\.sourceIDs))
        next.sources.removeAll { !active.contains($0.id) }
        try commit(next)
    }
    func deletePending(_ id: UUID) throws {
        var next = archive
        next.pending.removeAll { $0.id == id }
        try commit(next)
    }
    func deleteAll() throws { try commit(Archive()) }
    private func commit(_ next: Archive, newImage: (String, Data)? = nil) throws {
        guard loadError == nil else { throw RecordError.unsupportedArchive }
        if let (name, data) = newImage {
            try data.write(to: imageURL(name), options: [.atomic, .completeFileProtection])
        }
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(next).write(to: indexURL, options: [.atomic, .completeFileProtection])
        } catch {
            if let (name, _) = newImage {
                do { try manager.removeItem(at: imageURL(name)) }
                catch { loadError = "索引写入失败，且临时原图清理失败：\(error.localizedDescription)" }
            }
            throw error
        }
        let newNames = Set(next.sources.map(\.imageName) + next.pending.map(\.imageName))
        archive = next
        // Also clean images left by an interrupted transaction; a later delete retries failures.
        let ownedImages = try manager.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "image" && UUID(uuidString: $0.deletingPathExtension().lastPathComponent) != nil }
        var cleanupFailures: [String] = []
        for image in ownedImages where !newNames.contains(image.lastPathComponent) {
            do { try manager.removeItem(at: image) }
            catch { cleanupFailures.append(error.localizedDescription) }
        }
        if !cleanupFailures.isEmpty {
            throw RecordError.storage("记录索引已更新，但有原图未删除。请保持手机解锁后重试“删除全部”：\(cleanupFailures.joined(separator: "；"))")
        }
    }
    func exportCSV() -> String {
        let keys = availableMetrics
        func quote(_ text: String) -> String { "\"" + text.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        var rows = [["测量时间（报告本地时间，时区未知）", "数据来源", "原图来源标识"] +
                    keys.map { $0.name + ($0.unit.isEmpty ? "" : " (\($0.unit))") }]
        for record in archive.measurements.sorted(by: { $0.measuredAt < $1.measuredAt }) {
            rows.append([ReportDate.formatter("yyyy-MM-dd HH:mm").string(from: record.measuredAt),
                         record.kind == .complete ? "完整报告" : "报告内历史",
                         record.sourceIDs.map(\.uuidString).joined(separator: ";")] +
                        keys.map { definition in record.metrics[definition.id].map { definition.format($0.value) } ?? "" })
        }
        return "\u{FEFF}" + rows.map { $0.map(quote).joined(separator: ",") }.joined(separator: "\r\n")
    }
}
