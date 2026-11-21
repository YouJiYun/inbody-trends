import AppKit
import Foundation

// Independent synthetic layout and values. No photographs, identity fields or user data.
let destination = CommandLine.arguments.dropFirst().first.map { URL(fileURLWithPath: $0, isDirectory: true) }
guard let destination else {
    fputs("Usage: swift GenerateSyntheticReports.swift OUTPUT_DIRECTORY\n", stderr)
    exit(2)
}
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)

enum Variant: String, CaseIterable {
    case clear = "clear"
    case missingDate = "missing-date"
    case missingMuscle = "missing-muscle"
    case conflictingWeight = "conflicting-weight"
}

let width = 1600
let height = 2200

func generate(_ variant: Variant) throws {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
                                       bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                       isPlanar: false, colorSpaceName: .deviceRGB,
                                       bytesPerRow: width * 4, bitsPerPixel: 32),
          let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw NSError(domain: "SyntheticFixtures", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Cannot create the image context."])
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSColor.white.setFill()
    NSRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)).fill()

    func text(_ value: String, _ x: Double, _ y: Double, size: CGFloat = 28, bold: Bool = false) {
        let font = NSFont.systemFont(ofSize: size, weight: bold ? .bold : .regular)
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byClipping
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font, .foregroundColor: NSColor.black, .paragraphStyle: style
        ]
        let attributed = NSAttributedString(string: value, attributes: attributes)
        let measured = attributed.size()
        attributed.draw(at: NSPoint(x: x * Double(width), y: Double(height) - y * Double(height) - Double(measured.height)))
    }
    func line(_ x: Double, _ y: Double, _ length: Double, thickness: CGFloat = 1) {
        let path = NSBezierPath()
        path.move(to: NSPoint(x: x * Double(width), y: Double(height) * (1 - y)))
        path.line(to: NSPoint(x: (x + length) * Double(width), y: Double(height) * (1 - y)))
        path.lineWidth = thickness
        NSColor.black.setStroke()
        path.stroke()
    }
    func title(_ value: String, _ x: Double, _ y: Double) {
        text(value, x, y, size: 32, bold: true)
        line(x, y + 0.024, x < 0.6 ? 0.53 : 0.27)
    }
    text("体测报告 · 完全合成测试", 0.07, 0.05, size: 46, bold: true)
    text("InBody 格式模拟，不是真实报告", 0.07, 0.09, size: 22)
    if variant != .missingDate { text("2032.04.16 08:35", 0.44, 0.12, size: 30) }
    else { text("日期区域缺失", 0.44, 0.12, size: 30) }

    title("人体成分分析", 0.07, 0.18)
    let components: [(String, String, String, String)] = [
        ("身体总水分", "(L)", "41.2", "(35.0~48.0)"),
        ("蛋白质", "(kg)", "10.8", "(9.0~13.0)"),
        ("无机盐", "(kg)", "4.10", "(3.00~4.80)"),
        ("体脂肪", "(kg)", "18.7", "(10.0~20.0)"),
        ("体重", "(kg)", variant == .conflictingWeight ? "82.6" : "74.8", "(55.0~85.0)")
    ]
    for (index, row) in components.enumerated() {
        let y = 0.23 + Double(index) * 0.03
        text(row.0, 0.23, y)
        text(row.1, 0.38, y, size: 24)
        text(row.2, 0.44, y, size: 30)
        text(row.3, 0.51, y, size: 22)
    }
    title("肌肉脂肪分析", 0.07, 0.40)
    for (index, pair) in [("体重", "74.8"), ("骨骼肌", "29.6"), ("体脂肪", "18.7")].enumerated() {
        let y = 0.445 + Double(index) * 0.045
        text(pair.0, 0.07, y)
        text("(kg)", 0.17, y, size: 22)
        for (tickIndex, tick) in ["55", "70", "85", "100", "115", "130", "145", "160"].enumerated() {
            text(tick, 0.24 + Double(tickIndex) * 0.05, y - 0.018, size: 14)
        }
        line(0.24, y + 0.015, 0.16, thickness: 7)
        if index != 1 || variant != .missingMuscle {
            text(pair.1, 0.415, y, size: 34, bold: true)
        }
    }
    title("肥胖分析", 0.07, 0.57)
    for (index, pair) in [("身体质量指数", "24.4"), ("体脂百分比", "25.0")].enumerated() {
        let y = 0.63 + Double(index) * 0.06
        text(pair.0, 0.07, y)
        for (tickIndex, tick) in ["10.0", "15.0", "18.5", "22.0", "25.0", "30.0", "35.0"].enumerated() {
            text(tick, 0.24 + Double(tickIndex) * 0.055, y - 0.022, size: 14)
        }
        line(0.24, y + 0.015, 0.16, thickness: 7)
        text(pair.1, 0.415, y, size: 36, bold: true)
    }
    title("肌肉均衡", 0.07, 0.75)
    text("本合成样例省略分段图", 0.07, 0.79, size: 22)
    title("人体成分测试历史记录", 0.07, 0.89)
    text("本合成样例没有历史测量", 0.07, 0.93, size: 22)

    title("InBody 评分", 0.68, 0.20)
    text("79", 0.73, 0.245, size: 68, bold: true)
    text("/100 分", 0.795, 0.262, size: 24)
    title("体重控制", 0.68, 0.31)
    for (index, pair) in [("目标体重", "73.0 kg"), ("体重控制", "-1.8 kg"),
                          ("脂肪控制", "-1.8 kg"), ("肌肉控制", "0.0 kg")].enumerated() {
        let y = 0.345 + Double(index) * 0.025
        text(pair.0, 0.68, y, size: 24)
        text(pair.1, 0.83, y, size: 28)
    }
    title("肥胖评估", 0.68, 0.46)
    text("此处仅为合成干扰文本", 0.68, 0.50, size: 22)
    title("研究项目", 0.68, 0.58)
    text("去脂体重", 0.68, 0.62)
    text("56.1 kg", 0.83, 0.62)
    text("基础代谢率", 0.68, 0.66)
    text("1535 kcal", 0.83, 0.66)
    title("运动热量消耗", 0.68, 0.75)
    text("多列干扰，不能当作核心指标", 0.68, 0.80, size: 18)
    text("99.9   55.5   40.4", 0.68, 0.84, size: 30)
    text("图表刻度与参考区间均非测量结果", 0.07, 0.98, size: 20)

    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "SyntheticFixtures", code: 2,
                      userInfo: [NSLocalizedDescriptionKey: "Cannot encode synthetic fixture."])
    }
    try data.write(to: destination.appendingPathComponent(variant.rawValue + ".png"), options: .atomic)
}

for variant in Variant.allCases { try generate(variant) }
print("Generated four independent synthetic Chinese report PNGs. No OCR has run yet.")
