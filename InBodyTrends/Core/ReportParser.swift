import Foundation

struct TextBox: Codable, Sendable {
    let text: String
    let confidence: Double
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    var midX: Double { x + width / 2 }
    var midY: Double { y + height / 2 }
    var compact: String {
        text.replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "（", with: "(")
            .replacingOccurrences(of: "）", with: ")")
    }
}

struct NumberBox: Sendable {
    let text: String
    let value: Double
    let box: TextBox
    let reference: Bool
    let unit: String?
}

struct OCRDocument: Sendable {
    let lines: [TextBox]
    let numbers: [NumberBox]
    let dates: [TextBox]
    let times: [TextBox]
    init(lines: [TextBox], numbers: [NumberBox], dates: [TextBox] = [], times: [TextBox] = []) {
        self.lines = lines
        self.numbers = numbers
        self.dates = dates
        self.times = times
    }
}

struct ReportParser {
    private let document: OCRDocument
    private var lines: [TextBox] { document.lines }
    private var numbers: [NumberBox] { document.numbers.filter { !$0.reference && $0.box.confidence >= 0.8 } }
    init(document: OCRDocument) { self.document = document }

    func parse(sourceID: UUID) throws -> ParsedReport {
        guard let composition = anchor(["人体成分分析"]),
              let muscleSection = anchor(["肌肉脂肪分析"]),
              let obesity = anchor(["肥胖分析"]),
              let segment = anchor(["肌肉均衡", "节段肌肉", "分段肌肉"]),
              let score = anchor(["InBody评分", "InBody得分"]),
              composition.midY < muscleSection.midY,
              muscleSection.midY < obesity.midY, obesity.midY < segment.midY else {
            throw RecordError.recognition("未可靠识别中文 InBody 报告的分析分区")
        }
        let divider = score.x - 0.008
        guard divider > composition.x + 0.3 else {
            throw RecordError.recognition("报告列布局不清晰")
        }
        let header = lines.filter { $0.midY < composition.y }
        let dateTexts = header.filter { $0.midX > composition.x + 0.25 && $0.confidence >= 0.8 }
        var dates = Set(dateTexts.compactMap { ReportDate.parse($0.text) })
        // Vision may split a date and time into neighboring observations.
        for dateLine in dateTexts {
            let row = dateTexts.filter { abs($0.midY - dateLine.midY) < max($0.height, dateLine.height) * 0.65 }
                .sorted { $0.x < $1.x }.map(\.text).joined(separator: " ")
            if let date = ReportDate.parse(row) { dates.insert(date) }
        }
        guard dates.count == 1, let measuredAt = dates.first else {
            throw RecordError.recognition("测量日期与时间缺失或不唯一")
        }
        var metrics: [String: MetricValue] = [:]
        var issues: [String] = []
        let compositionRegion = Region(left: composition.x - 0.02, right: divider,
                                       top: composition.y + composition.height, bottom: muscleSection.y)
        let compositionFields: [(String, [String], String)] = [
            ("water", ["身体总水分", "体内总水分"], "L"),
            ("protein", ["蛋白质"], "kg"), ("minerals", ["无机盐"], "kg"),
            ("fat", ["体脂肪"], "kg"), ("weight", ["体重"], "kg")
        ]
        for (key, labels, unit) in compositionFields {
            if let value = rowValue(labels, in: compositionRegion, unit: unit) {
                try add(value, key: key, to: &metrics)
            }
        }
        // This chart's ticks are integers. Require three distinct decimal-valued bar endpoints.
        let muscleRegion = Region(left: composition.x + 0.06, right: divider,
                                  top: muscleSection.y + muscleSection.height, bottom: obesity.y)
        let bars = decimalRows(in: muscleRegion)
        guard bars.count == 3 else {
            throw RecordError.recognition("体重、骨骼肌和脂肪条形图数值无法与刻度可靠区分")
        }
        for (key, value) in zip(["weight", "muscle", "fat"], bars) {
            try add(value, key: key, to: &metrics)
        }
        let obesityRegion = Region(left: composition.x + 0.06, right: divider,
                                   top: obesity.y + obesity.height, bottom: segment.y)
        let obesityBars = decimalRows(in: obesityRegion, requireLargeType: true)
        guard obesityBars.count == 2 else {
            throw RecordError.recognition("BMI 与体脂率的结果无法与小字刻度可靠区分")
        }
        try add(obesityBars[0], key: "bmi", to: &metrics)
        try add(obesityBars[1], key: "pbf", to: &metrics)

        let rightRegion = Region(left: divider, right: 1, top: score.y, bottom: 1)
        if let control = anchor(["体重控制"], in: rightRegion) {
            let scoreCandidates = numbers.filter {
                $0.box.midX > divider && $0.box.y > score.y &&
                $0.box.midY < control.y && (0...150).contains($0.value) && !$0.text.contains(".")
            }
            // The score is larger than /100 and the explanatory paragraph.
            if let largest = scoreCandidates.max(by: { $0.box.height < $1.box.height }),
               scoreCandidates.filter({ $0.box.height > largest.box.height * 0.8 }).count == 1 {
                try add(largest, key: "score", to: &metrics)
            }
            let bottom = anchor(["肥胖评估"], in: rightRegion)?.y ?? control.y + 0.1
            let region = Region(left: divider, right: 1, top: control.y + control.height, bottom: bottom)
            for (key, label) in [("target", "目标体重"), ("weightControl", "体重控制"),
                                 ("fatControl", "脂肪控制"), ("muscleControl", "肌肉控制")] {
                if let value = rowValue([label], in: region, unit: "kg") {
                    try add(value, key: key, to: &metrics)
                }
            }
        }
        let rightFields: [(String, [String], String?)] = [
            ("ffm", ["去脂体重"], "kg"), ("bmr", ["基础代谢率"], "kcal"),
            ("obesity", ["肥胖度"], "%"), ("smi", ["SMI"], "kg/m²"),
            ("calories", ["建议的热量摄入", "建议热量摄入"], "kcal")
        ]
        for (key, labels, unit) in rightFields {
            if let value = rowValue(labels, in: rightRegion, unit: unit) {
                try add(value, key: key, to: &metrics)
            }
        }
        if let whr = anchor(["腰臀比"], in: rightRegion),
           let visceral = anchor(["内脏脂肪等级"], in: rightRegion) {
            let candidates = numbers.filter {
                $0.box.midX > divider && $0.box.y > whr.y + whr.height &&
                $0.box.midY < visceral.y && (0.4...1.5).contains($0.value) && $0.text.contains(".")
            }
            if let largest = candidates.max(by: { $0.box.height < $1.box.height }),
               candidates.filter({ $0.box.height > largest.box.height * 0.8 }).count == 1 {
                try add(largest, key: "whr", to: &metrics)
            }
            let bottom = anchor(["研究项目"], in: rightRegion)?.y ?? visceral.y + 0.06
            let region = Region(left: divider, right: 1, top: visceral.y + visceral.height, bottom: bottom)
            if let value = rowValue(["等级"], in: region, unit: nil) {
                try add(value, key: "visceral", to: &metrics)
            }
        }
        try validate(metrics: metrics, header: header)
        parseSegments(start: segment, divider: divider, metrics: &metrics, issues: &issues)
        parseImpedance(rightRegion: rightRegion, metrics: &metrics, issues: &issues)
        let history = parseHistory(current: measuredAt, sourceID: sourceID, divider: divider, issues: &issues)
        let missing = MetricDefinition.basic.filter { metrics[$0.id] == nil }.map(\.name)
        if !missing.isEmpty { issues.append("未可靠识别：" + missing.joined(separator: "、")) }
        issues.append("未提取运动热量表、参考区间及文字评价；分段/阻抗只保存可明确定位且带可靠单位的数值。")
        return ParsedReport(current: Measurement(measuredAt: measuredAt, kind: .complete,
                                                 metrics: metrics, sourceIDs: [sourceID]),
                            history: history, issues: issues)
    }

    private struct Region {
        let left: Double
        let right: Double
        let top: Double
        let bottom: Double
        func contains(_ box: TextBox) -> Bool {
            box.midX >= left && box.midX <= right && box.midY >= top && box.midY < bottom
        }
    }
    private func anchor(_ labels: [String], in region: Region? = nil) -> TextBox? {
        lines.filter { line in
            line.confidence >= 0.65 && (region?.contains(line) ?? true) &&
            labels.contains(where: { line.compact.contains($0) })
        }.sorted { abs($0.y - $1.y) < 0.002 ? $0.width < $1.width : $0.y < $1.y }.first
    }
    private func rowValue(_ labels: [String], in region: Region, unit: String?) -> NumberBox? {
        guard let label = anchor(labels, in: region) else { return nil }
        let row = numbers.filter {
            region.contains($0.box) && $0.box.midX > label.x + min(label.width, 0.07) &&
            abs($0.box.midY - label.midY) < max(label.height, $0.box.height) * 0.75
        }.sorted { $0.box.x < $1.box.x }
        let candidates = row.filter { value in
            if let unit { return value.unit == unit }
            return value.unit == nil
        }
        // A numeric token inside a reference interval is already excluded.
        return candidates.count == 1 ? candidates[0] : nil
    }
    private func decimalRows(in region: Region, requireLargeType: Bool = false) -> [NumberBox] {
        var candidates = numbers.filter { region.contains($0.box) && $0.text.contains(".") }
        if requireLargeType, let maxHeight = candidates.map(\.box.height).max() {
            candidates = candidates.filter { $0.box.height >= maxHeight * 0.82 }
        }
        candidates.sort { $0.box.midY < $1.box.midY }
        var rows: [[NumberBox]] = []
        for number in candidates {
            if let index = rows.firstIndex(where: {
                abs($0[0].box.midY - number.box.midY) < max($0[0].box.height, number.box.height) * 0.65
            }) { rows[index].append(number) } else { rows.append([number]) }
        }
        guard rows.allSatisfy({ $0.count == 1 }) else { return [] }
        return rows.map { $0[0] }
    }
    private func add(_ number: NumberBox, key: String, to metrics: inout [String: MetricValue]) throws {
        guard let definition = MetricDefinition.find(key), definition.range.contains(number.value) else {
            throw RecordError.recognition("识别数值超出可接受范围")
        }
        if let previous = metrics[key], abs(previous.value - number.value) > 0.051 {
            throw RecordError.recognition("\(definition.name)在报告多个区域中互相矛盾")
        }
        metrics[key] = MetricValue(value: number.value, confidence: number.box.confidence)
    }
    private func validate(metrics: [String: MetricValue], header: [TextBox]) throws {
        guard let weight = metrics["weight"]?.value, let muscle = metrics["muscle"]?.value,
              let fat = metrics["fat"]?.value, let pbf = metrics["pbf"]?.value,
              let bmi = metrics["bmi"]?.value, muscle + fat < weight,
              abs(fat / weight * 100 - pbf) <= 0.3 else {
            throw RecordError.recognition("核心数据缺失或脂肪重量与体脂率不一致")
        }
        if let water = metrics["water"]?.value, let protein = metrics["protein"]?.value,
           let minerals = metrics["minerals"]?.value,
           abs(water + protein + minerals + fat - weight) > 0.5 {
            throw RecordError.recognition("人体成分总和与体重不一致")
        }
        if let ffm = metrics["ffm"]?.value, abs(ffm + fat - weight) > 0.3 {
            throw RecordError.recognition("去脂体重与脂肪重量不一致")
        }
        let heights = document.numbers.filter {
            $0.unit == "cm" && !$0.reference && $0.box.confidence >= 0.8 &&
            $0.box.midY < (header.map(\.midY).max() ?? 0) + 0.01 && (100...230).contains($0.value)
        }
        if heights.count == 1 {
            let meters = heights[0].value / 100
            guard abs(weight / (meters * meters) - bmi) < 0.3 else {
                throw RecordError.recognition("BMI 与报告身高、体重不一致")
            }
        }
    }

    private func parseSegments(start: TextBox, divider: Double,
                               metrics: inout [String: MetricValue], issues: inout [String]) {
        let leftRegion = Region(left: start.x - 0.02, right: divider, top: start.y, bottom: 1)
        guard let fatTitle = anchor(["节段脂肪分析", "分段脂肪分析"], in: leftRegion),
              let history = anchor(["人体成分测试历史", "人体成分测试历史记录"], in: leftRegion) else {
            issues.append("分段数据未识别：图区边界不清晰"); return
        }
        for (kind, left, right) in [("lean", start.x - 0.02, fatTitle.x - 0.01),
                                    ("fat", fatTitle.x - 0.01, divider)] {
            let region = Region(left: left, right: right, top: max(start.y + start.height, fatTitle.y + fatTitle.height),
                                bottom: history.y)
            let masses = numbers.filter { region.contains($0.box) && $0.unit == "kg" }
            let percents = numbers.filter { region.contains($0.box) && $0.unit == "%" }
            let leftLabel = anchor(["左"], in: region)
            let rightLabel = anchor(["右"], in: region)
            guard masses.count == 5, percents.count == 5,
                  let leftLabel, let rightLabel, leftLabel.midX < rightLabel.midX else {
                issues.append("\(kind == "lean" ? "分段肌肉" : "分段脂肪")未识别：数量、单位或左右标记不可靠"); continue
            }
            let sorted = masses.sorted { $0.box.midY < $1.box.midY }
            let top = Array(sorted.prefix(2)).sorted { $0.box.midX < $1.box.midX }
            let bottom = Array(sorted.suffix(2)).sorted { $0.box.midX < $1.box.midX }
            let trunk = sorted[2]
            guard abs(top[0].box.midY - top[1].box.midY) < 0.04,
                  abs(bottom[0].box.midY - bottom[1].box.midY) < 0.04,
                  trunk.box.midY > top.map(\.box.midY).max()!,
                  trunk.box.midY < bottom.map(\.box.midY).min()!,
                  trunk.box.midX > top[0].box.midX && trunk.box.midX < top[1].box.midX else {
                issues.append("分段数据未识别：人体图布局不明确"); continue
            }
            for (limb, mass) in zip(["leftArm", "rightArm", "trunk", "leftLeg", "rightLeg"],
                                    [top[0], top[1], trunk, bottom[0], bottom[1]]) {
                let ratios = percents.filter {
                    abs($0.box.midX - mass.box.midX) < 0.035 &&
                    $0.box.midY > mass.box.midY && $0.box.midY - mass.box.midY < 0.03
                }
                guard ratios.count == 1,
                      let massDef = MetricDefinition.find("\(kind).\(limb).kg"),
                      let pctDef = MetricDefinition.find("\(kind).\(limb).percent"),
                      massDef.range.contains(mass.value), pctDef.range.contains(ratios[0].value) else {
                    issues.append("某项分段数据未识别：缺少清晰的重量/比例配对"); continue
                }
                metrics[massDef.id] = MetricValue(value: mass.value, confidence: mass.box.confidence)
                metrics[pctDef.id] = MetricValue(value: ratios[0].value, confidence: ratios[0].box.confidence)
            }
        }
    }
    private func parseImpedance(rightRegion: Region, metrics: inout [String: MetricValue], issues: inout [String]) {
        guard let title = anchor(["生物电阻抗"], in: rightRegion) else {
            issues.append("生物电阻抗未识别"); return
        }
        let region = Region(left: rightRegion.left, right: 1, top: title.y + title.height, bottom: 1)
        let labels = ["右上肢", "左上肢", "躯干", "右下肢", "左下肢"]
        let columns = labels.compactMap { anchor([$0], in: region) }
        guard columns.count == 5, zip(columns, columns.dropFirst()).allSatisfy({ $0.0.midX < $0.1.midX }) else {
            issues.append("阻抗表头不完整，未猜测左右次序"); return
        }
        for frequency in [20, 100] {
            guard let frequencyBox = lines.first(where: {
                region.contains($0) && $0.compact.lowercased().contains("\(frequency)khz")
            }) else { continue }
            let values = numbers.filter {
                region.contains($0.box) && $0.box.midX > frequencyBox.x + min(frequencyBox.width, 0.05) &&
                $0.unit != "kHz" && $0.text.contains(".") &&
                abs($0.box.midY - frequencyBox.midY) < max($0.box.height, frequencyBox.height) * 0.75
            }.sorted { $0.box.midX < $1.box.midX }
            guard values.count == 5 else { issues.append("\(frequency) kHz 阻抗行不完整"); continue }
            for (index, limb) in ["rightArm", "leftArm", "trunk", "rightLeg", "leftLeg"].enumerated() {
                let value = values[index]
                let distances = columns.map { abs($0.midX - value.box.midX) }
                guard distances[index] == distances.min(), (1...2000).contains(value.value) else { continue }
                metrics["z.\(frequency).\(limb)"] = MetricValue(value: value.value, confidence: value.box.confidence)
            }
        }
    }
    private func parseHistory(current: Date, sourceID: UUID, divider: Double, issues: inout [String]) -> [Measurement] {
        guard let title = anchor(["人体成分测试历史"]) else {
            issues.append("未识别报告内历史"); return []
        }
        let region = Region(left: title.x - 0.02, right: divider, top: title.y + title.height, bottom: 1)
        let datePattern = #"(?:\d{4}|\d{2})[.\-/]\d{2}[.\-/]\d{2}"#
        guard let regex = try? NSRegularExpression(pattern: datePattern) else { return [] }
        let dateLines = (document.dates.isEmpty ? lines : document.dates).filter {
            region.contains($0) && $0.confidence >= 0.8 &&
            regex.numberOfMatches(in: $0.text, range: NSRange($0.text.startIndex..., in: $0.text)) == 1
        }
        var result: [Measurement] = []
        for dateLine in dateLines {
            let neighbors = (document.times.isEmpty ? lines : document.times).filter {
                region.contains($0) && $0.confidence >= 0.8 && abs($0.midX - dateLine.midX) < 0.018 &&
                $0.midY >= dateLine.midY - 0.005 && $0.midY - dateLine.midY < 0.03
            }.sorted { $0.midY < $1.midY }
            let text = document.times.isEmpty ? neighbors.map(\.text).joined(separator: " ")
                : dateLine.text + " " + neighbors.map(\.text).joined(separator: " ")
            guard document.times.isEmpty || neighbors.count == 1 else { continue }
            guard let date = ReportDate.parse(text, allowShortYear: true), date <= current,
                  date != current else { continue }
            let aligned = numbers.filter {
                region.contains($0.box) && $0.box.midY < dateLine.y &&
                abs($0.box.midX - dateLine.midX) < 0.018 && $0.text.contains(".")
            }.sorted { $0.box.midY < $1.box.midY }
            guard aligned.count == 3,
                  MetricDefinition.find("weight")!.range.contains(aligned[0].value),
                  MetricDefinition.find("muscle")!.range.contains(aligned[1].value),
                  MetricDefinition.find("pbf")!.range.contains(aligned[2].value),
                  aligned[1].value < aligned[0].value else { continue }
            let keys = ["weight", "muscle", "pbf"]
            let values = Dictionary(uniqueKeysWithValues: zip(keys, aligned).map {
                ($0.0, MetricValue(value: $0.1.value, confidence: $0.1.box.confidence))
            })
            result.append(Measurement(measuredAt: date, kind: .history, metrics: values, sourceIDs: [sourceID]))
        }
        if result.isEmpty { issues.append("底部历史日期/列不够清晰，未导入历史；可以逐张导入旧报告") }
        else { issues.append("历史仅提取体重、骨骼肌、体脂率；不清晰的历史列已跳过") }
        return result
    }
}
