import Foundation

struct MetricDefinition: Identifiable, Hashable {
    let id: String
    let name: String
    let unit: String
    let category: String
    let range: ClosedRange<Double>
    let decimals: Int
    let explanation: String

    static let basic: [MetricDefinition] = [
        .init(id: "weight", name: "体重", unit: "kg", category: "核心", range: 15...350, decimals: 1, explanation: "身体的总重量。请结合肌肉与脂肪变化理解，不代表越轻越好。"),
        .init(id: "muscle", name: "骨骼肌", unit: "kg", category: "核心", range: 5...100, decimals: 1, explanation: "骨骼肌重量，不等于去脂体重或分段肌肉总和。"),
        .init(id: "fat", name: "体脂肪", unit: "kg", category: "核心", range: 0.5...200, decimals: 1, explanation: "报告估计的脂肪重量。"),
        .init(id: "bmi", name: "BMI", unit: "kg/m²", category: "核心", range: 8...80, decimals: 1, explanation: "体重除以身高平方，不能单独区分肌肉与脂肪。"),
        .init(id: "pbf", name: "体脂率", unit: "%", category: "核心", range: 1...70, decimals: 1, explanation: "脂肪占体重的百分比。差异单位为百分点。"),
        .init(id: "score", name: "InBody 评分", unit: "分", category: "人体成分", range: 0...150, decimals: 0, explanation: "设备生成的综合评分，不是医学诊断。"),
        .init(id: "water", name: "身体总水分", unit: "L", category: "人体成分", range: 5...150, decimals: 1, explanation: "生物电阻抗估算的总体水分，受测量状态影响。"),
        .init(id: "protein", name: "蛋白质", unit: "kg", category: "人体成分", range: 1...50, decimals: 1, explanation: "身体成分估计值，并非膳食蛋白摄入量。"),
        .init(id: "minerals", name: "无机盐", unit: "kg", category: "人体成分", range: 0.5...15, decimals: 2, explanation: "报告估算的无机盐总量，不是骨密度检查。"),
        .init(id: "target", name: "目标体重", unit: "kg", category: "体重控制", range: 15...350, decimals: 1, explanation: "设备建议值，不是个人医疗或营养处方。"),
        .init(id: "weightControl", name: "体重控制", unit: "kg", category: "体重控制", range: -150...150, decimals: 1, explanation: "设备建议调整量，保留正负号。"),
        .init(id: "fatControl", name: "脂肪控制", unit: "kg", category: "体重控制", range: -150...150, decimals: 1, explanation: "设备建议的脂肪调整量。"),
        .init(id: "muscleControl", name: "肌肉控制", unit: "kg", category: "体重控制", range: -80...80, decimals: 1, explanation: "设备建议的肌肉调整量。"),
        .init(id: "whr", name: "腰臀比", unit: "", category: "研究项目", range: 0.4...1.5, decimals: 2, explanation: "腰围与臀围的比值。"),
        .init(id: "visceral", name: "内脏脂肪等级", unit: "级", category: "研究项目", range: 1...30, decimals: 0, explanation: "设备的等级估计，不等于影像检查。"),
        .init(id: "ffm", name: "去脂体重", unit: "kg", category: "研究项目", range: 10...200, decimals: 1, explanation: "除去脂肪后的重量，不能当作骨骼肌重量。"),
        .init(id: "bmr", name: "基础代谢率", unit: "kcal", category: "研究项目", range: 400...5000, decimals: 0, explanation: "静息能量消耗估计，不是每日热量处方。"),
        .init(id: "obesity", name: "肥胖度", unit: "%", category: "研究项目", range: 30...300, decimals: 0, explanation: "设备相对标准体重的百分比。"),
        .init(id: "smi", name: "SMI", unit: "kg/m²", category: "研究项目", range: 1...25, decimals: 1, explanation: "报告的骨骼肌指数。"),
        .init(id: "calories", name: "建议热量摄入", unit: "kcal", category: "研究项目", range: 500...7000, decimals: 0, explanation: "设备的通用建议值，本应用不制定饮食处方。")
    ]
    static let limbs: [(String, String)] = [
        ("leftArm", "左上肢"), ("rightArm", "右上肢"), ("trunk", "躯干"),
        ("leftLeg", "左下肢"), ("rightLeg", "右下肢")
    ]
    static let all: [MetricDefinition] = {
        var definitions = basic
        for limb in limbs {
            for kind in ["lean", "fat"] {
                let segmentName = kind == "lean" ? "肌肉" : "脂肪"
                let category = kind == "lean" ? "分段肌肉" : "分段脂肪"
                for unit in ["kg", "percent"] {
                    let isMass = unit == "kg"
                    let range: ClosedRange<Double> = isMass ? 0...100 : 1...900
                    let name = limb.1 + segmentName + (isMass ? "" : "比例")
                    let explanation = isMass ? "报告中该部位的估计重量。" : "相对设备参考值的比例，不是体脂率。"
                    definitions.append(MetricDefinition(
                        id: "\(kind).\(limb.0).\(unit)", name: name,
                        unit: isMass ? "kg" : "%", category: category,
                        range: range, decimals: 1, explanation: explanation))
                }
            }
            for frequency in [20, 100] {
                definitions.append(MetricDefinition(
                    id: "z.\(frequency).\(limb.0)", name: "\(limb.1) · \(frequency) kHz",
                    unit: "Ω", category: "生物电阻抗", range: 1...2000, decimals: 1,
                    explanation: "该频率下测得的电阻抗；仅用于追溯，不用于自行诊断。"))
            }
        }
        return definitions
    }()
    static func find(_ id: String) -> MetricDefinition? { all.first { $0.id == id } }
    func format(_ value: Double) -> String {
        String(format: "%.\(decimals)f", locale: Locale(identifier: "en_US_POSIX"), value)
    }
}

struct MetricValue: Codable, Equatable {
    let value: Double
    let confidence: Double
}

enum MeasurementKind: String, Codable { case complete, history }

struct Measurement: Codable, Identifiable, Equatable {
    var id: UUID = UUID()
    let measuredAt: Date
    var kind: MeasurementKind
    var metrics: [String: MetricValue]
    var sourceIDs: [UUID]
}

struct ReportSource: Codable, Identifiable {
    let id: UUID
    let importedAt: Date
    let imageName: String
    let digest: String
    let issues: [String]
}

struct PendingScan: Codable, Identifiable {
    let id: UUID
    let importedAt: Date
    let imageName: String
    let reason: String
}

struct Archive: Codable {
    var schemaVersion = 1
    var measurements: [Measurement] = []
    var sources: [ReportSource] = []
    var pending: [PendingScan] = []
}

struct ParsedReport {
    let current: Measurement
    let history: [Measurement]
    let issues: [String]
}

enum RecordError: LocalizedError {
    case recognition(String)
    case storage(String)
    case conflict
    case unsupportedArchive
    var errorDescription: String? {
        switch self {
        case .recognition(let reason): return reason + "。请重新拍摄完整、清晰的报告，无须手填。"
        case .storage(let reason): return reason
        case .conflict: return "同一测量时间存在矛盾数据，未保存或覆盖。请核对原图，重新拍摄；不同人的报告应分开管理。"
        case .unsupportedArchive: return "本地数据版本不受支持，未覆盖原文件。"
        }
    }
}

enum ReportDate {
    // The report has no time zone. Keep its wall-clock time stable across device time zones.
    static var calendar: Calendar {
        var result = Calendar(identifier: .gregorian)
        result.timeZone = TimeZone(secondsFromGMT: 0)!
        return result
    }
    static func formatter(_ pattern: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = pattern
        formatter.isLenient = false
        return formatter
    }
    static func parse(_ text: String, allowShortYear: Bool = false) -> Date? {
        let pattern = allowShortYear
            ? #"(?<!\d)(\d{4}|\d{2})[.\-/](\d{2})[.\-/](\d{2})\s+(\d{2}):(\d{2})(?!\d)"#
            : #"(?<!\d)(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s+(\d{2}):(\d{2})(?!\d)"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        let parts = (1...5).compactMap { Range(match.range(at: $0), in: text).map { String(text[$0]) } }
        guard parts.count == 5 else { return nil }
        let year = parts[0].count == 2 ? "20" + parts[0] : parts[0]
        let normalized = "\(year)-\(parts[1])-\(parts[2]) \(parts[3]):\(parts[4])"
        guard let date = formatter("yyyy-MM-dd HH:mm").date(from: normalized),
              formatter("yyyy-MM-dd HH:mm").string(from: date) == normalized,
              let numericYear = Int(year), (2000...2099).contains(numericYear) else { return nil }
        return date
    }
    static func display(_ date: Date) -> String {
        formatter("yyyy 年 M 月 d 日 HH:mm").string(from: date)
    }
}

enum MeasurementMerge {
    static func merge(_ incoming: [Measurement], into existing: [Measurement]) throws -> [Measurement] {
        var result = existing
        for item in incoming {
            if let index = result.firstIndex(where: { $0.measuredAt == item.measuredAt }) {
                var old = result[index]
                for (key, newValue) in item.metrics {
                    if let oldValue = old.metrics[key], abs(oldValue.value - newValue.value) > 0.051 {
                        if old.kind == .complete && item.kind == .history { continue }
                        if old.kind == .history && item.kind == .complete {
                            old.metrics[key] = newValue
                            continue
                        }
                        throw RecordError.conflict
                    }
                    if old.metrics[key] == nil || item.kind == .complete {
                        old.metrics[key] = newValue
                    }
                }
                if item.kind == .complete { old.kind = .complete }
                old.sourceIDs = Array(Set(old.sourceIDs + item.sourceIDs)).sorted { $0.uuidString < $1.uuidString }
                result[index] = old
            } else {
                result.append(item)
            }
        }
        return result.sorted { $0.measuredAt < $1.measuredAt }
    }
}
