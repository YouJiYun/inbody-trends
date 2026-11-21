import Foundation
import Vision
import UIKit
import CoreImage
import ImageIO

enum LocalOCR {
    static func recognize(_ data: Data) async throws -> OCRDocument {
        try await Task.detached(priority: .userInitiated) {
            guard let image = UIImage(data: data), let cgImage = image.cgImage else {
                throw RecordError.recognition("图片无法解码")
            }
            let oriented = CIImage(cgImage: cgImage).oriented(forExifOrientation: image.imageOrientation.exif)
            let context = CIContext()
            let corrected = try straighten(oriented, context: context)
            guard let input = context.createCGImage(corrected, from: corrected.extent) else {
                throw RecordError.recognition("图片透视校正失败")
            }
            // Language priority affects confidence for dates and mixed Chinese/Latin headings.
            let requests = [["zh-Hans", "en-US"], ["en-US", "zh-Hans"]].map { languages in
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.recognitionLanguages = languages
                request.usesLanguageCorrection = false
                request.minimumTextHeight = 0.003
                request.customWords = ["InBody", "骨骼肌", "体脂肪", "无机盐", "腰臀比", "SMI", "kcal", "kHz"]
                return request
            }
            try VNImageRequestHandler(cgImage: input, options: [:]).perform(requests)
            let observations = requests.flatMap { $0.results ?? [] }
            guard !observations.isEmpty else {
                throw RecordError.recognition("未识别到文字")
            }
            let regex = try NSRegularExpression(pattern: #"(?<![\d.])[+\-−]?\d+(?:\.\d+)?(?![\d.])"#)
            let dateRegex = try NSRegularExpression(pattern: #"(?<!\d)(?:\d{4}|\d{2})[.\-/]\d{2}[.\-/]\d{2}(?!\d)"#)
            let timeRegex = try NSRegularExpression(pattern: #"(?<!\d)\d{2}:\d{2}(?!\d)"#)
            let labels = [
                "人体成分分析", "肌肉脂肪分析", "肥胖分析", "肌肉均衡", "节段肌肉", "分段肌肉",
                "节段脂肪分析", "分段脂肪分析", "InBody评分", "InBody 评分", "InBody得分", "InBody 得分",
                "人体成分测试历史记录", "人体成分测试历史", "身体总水分", "体内总水分", "蛋白质", "无机盐",
                "体脂肪", "体重", "目标体重", "体重控制", "脂肪控制", "肌肉控制", "肥胖评估",
                "腰臀比", "内脏脂肪等级", "等级", "研究项目", "去脂体重", "基础代谢率", "肥胖度",
                "SMI", "建议的热量摄入", "建议热量摄入", "生物电阻抗",
                "右上肢", "左上肢", "躯干", "右下肢", "左下肢", "左", "右"
            ].sorted { $0.count > $1.count }
            var lines: [TextBox] = []
            var numbers: [NumberBox] = []
            var dates: [TextBox] = []
            var times: [TextBox] = []
            for observation in observations {
                guard let text = observation.topCandidates(1).first else { continue }
                let line = box(text.string, confidence: text.confidence, rect: observation.boundingBox)
                lines.append(line)
                for label in labels {
                    if let range = text.string.range(of: label), let location = try text.boundingBox(for: range) {
                        lines.append(box(label, confidence: text.confidence, rect: location.boundingBox))
                    }
                }
                for (expression, isDate) in [(dateRegex, true), (timeRegex, false)] {
                    for match in expression.matches(in: text.string, range: NSRange(text.string.startIndex..., in: text.string)) {
                        guard let range = Range(match.range, in: text.string),
                              let location = try text.boundingBox(for: range) else { continue }
                        let token = box(String(text.string[range]), confidence: text.confidence, rect: location.boundingBox)
                        if isDate { dates.append(token) } else { times.append(token) }
                    }
                }
                for match in regex.matches(in: text.string, range: NSRange(text.string.startIndex..., in: text.string)) {
                    guard let range = Range(match.range, in: text.string),
                          let location = try text.boundingBox(for: range),
                          let value = Double(text.string[range].replacingOccurrences(of: "−", with: "-")) else { continue }
                    let prefix = String(text.string[..<range.lowerBound])
                    let suffix = String(text.string[range.upperBound...])
                    let opening = prefix.lastIndex(where: { $0 == "(" || $0 == "（" })
                    let closing = prefix.lastIndex(where: { $0 == ")" || $0 == "）" })
                    let reference = opening != nil && (closing == nil || opening! > closing!)
                    numbers.append(NumberBox(text: String(text.string[range]), value: value,
                                             box: box(String(text.string[range]), confidence: text.confidence,
                                                      rect: location.boundingBox),
                                             reference: reference, unit: unit(in: suffix)))
                }
            }
            let withUnits = numbers.map { number -> NumberBox in
                guard number.unit == nil else { return number }
                let nearby = lines.filter {
                    $0.midX < number.box.x && number.box.x - ($0.x + $0.width) < 0.09 &&
                    abs($0.midY - number.box.midY) < max($0.height, number.box.height) * 0.75 &&
                    $0.compact.count < 12
                }.sorted { $0.x > $1.x }
                let inferred = nearby.first.flatMap { unit(in: $0.text) }
                return NumberBox(text: number.text, value: number.value, box: number.box,
                                 reference: number.reference, unit: inferred)
            }
            var uniqueNumbers: [NumberBox] = []
            for number in withUnits {
                let index = uniqueNumbers.firstIndex { existing in
                    existing.value == number.value && existing.reference == number.reference &&
                    existing.unit == number.unit &&
                    abs(existing.box.midX - number.box.midX) < max(existing.box.width, number.box.width) * 0.35 &&
                    abs(existing.box.midY - number.box.midY) < max(existing.box.height, number.box.height) * 0.5
                }
                if let index {
                    if number.box.confidence > uniqueNumbers[index].box.confidence {
                        uniqueNumbers[index] = number
                    }
                } else {
                    uniqueNumbers.append(number)
                }
            }
            // Preserve disagreeing readings so the parser rejects ambiguity rather than choosing a value.
            return OCRDocument(lines: lines, numbers: uniqueNumbers, dates: dates, times: times)
        }.value
    }
    private static func box(_ text: String, confidence: Float, rect: CGRect) -> TextBox {
        TextBox(text: text, confidence: Double(confidence), x: Double(rect.minX),
                y: Double(1 - rect.maxY), width: Double(rect.width), height: Double(rect.height))
    }
    private static func unit(in text: String) -> String? {
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "（", with: "(")
            .replacingOccurrences(of: "）", with: ")").lowercased()
        let trimmed = normalized.hasPrefix("(") ? String(normalized.dropFirst()) : normalized
        if trimmed.hasPrefix("kg/m") || trimmed.hasPrefix("kg/㎡") { return "kg/m²" }
        if trimmed.hasPrefix("kg") { return "kg" }
        if trimmed.hasPrefix("kcal") { return "kcal" }
        if trimmed.hasPrefix("khz") { return "kHz" }
        if trimmed.hasPrefix("cm") { return "cm" }
        if trimmed.hasPrefix("%") { return "%" }
        if trimmed == "l" || trimmed.hasPrefix("l)") { return "L" }
        return nil
    }
    private static func straighten(_ image: CIImage, context: CIContext) throws -> CIImage {
        guard let cgImage = context.createCGImage(image, from: image.extent) else {
            throw RecordError.recognition("图片方向校正失败")
        }
        let request = VNDetectRectanglesRequest()
        request.maximumObservations = 1
        request.minimumAspectRatio = 0.45
        request.maximumAspectRatio = 0.95
        request.minimumSize = 0.35
        request.minimumConfidence = 0.8
        try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
        // If no page rectangle is found, section anchors still gate recognition.
        guard let rectangle = request.results?.first else { return image }
        func point(_ point: CGPoint) -> CIVector {
            CIVector(x: image.extent.minX + point.x * image.extent.width,
                     y: image.extent.minY + point.y * image.extent.height)
        }
        return image.applyingFilter("CIPerspectiveCorrection", parameters: [
            "inputTopLeft": point(rectangle.topLeft), "inputTopRight": point(rectangle.topRight),
            "inputBottomLeft": point(rectangle.bottomLeft), "inputBottomRight": point(rectangle.bottomRight)
        ])
    }
}

private extension UIImage.Orientation {
    var exif: Int32 {
        switch self {
        case .up: return 1
        case .upMirrored: return 2
        case .down: return 3
        case .downMirrored: return 4
        case .leftMirrored: return 5
        case .right: return 6
        case .rightMirrored: return 7
        case .left: return 8
        @unknown default: return 1
        }
    }
}
