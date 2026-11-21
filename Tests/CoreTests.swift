import XCTest
#if SWIFT_PACKAGE
@testable import InBodyCore
#else
@testable import InBodyTrends
#endif

final class CoreTests: XCTestCase {
    func testStrictDatesAndWallClockTime() throws {
        let date = try XCTUnwrap(ReportDate.parse("2032.02.28 06:25"))
        XCTAssertEqual(ReportDate.formatter("yyyy-MM-dd HH:mm").string(from: date), "2032-02-28 06:25")
        XCTAssertNil(ReportDate.parse("2032.02.30 06:25"))
        XCTAssertNil(ReportDate.parse("2032.09.21"))
        XCTAssertNil(ReportDate.parse("32.09.21 06:25"))
        XCTAssertNotNil(ReportDate.parse("32.09.21 06:25", allowShortYear: true))
        XCTAssertNil(ReportDate.parse("1999.09.21 06:25"))
    }
    func testFullReportUpgradesHistoricalPointAndSortsByMeasurementTime() throws {
        let earlier = try XCTUnwrap(ReportDate.parse("2032.03.08 09:10"))
        let later = try XCTUnwrap(ReportDate.parse("2032.04.08 09:10"))
        let source1 = UUID(), source2 = UUID()
        let history = Measurement(measuredAt: earlier, kind: .history,
                                  metrics: ["weight": .init(value: 63, confidence: 0.9)], sourceIDs: [source1])
        let full = Measurement(measuredAt: earlier, kind: .complete,
                               metrics: ["weight": .init(value: 63, confidence: 0.99),
                                         "bmi": .init(value: 21.2, confidence: 0.99)], sourceIDs: [source2])
        let recent = Measurement(measuredAt: later, kind: .complete, metrics: [:], sourceIDs: [source2])
        let merged = try MeasurementMerge.merge([recent, full], into: [history])
        XCTAssertEqual(merged.count, 2)
        XCTAssertEqual(merged[0].kind, .complete)
        XCTAssertEqual(merged[0].metrics["bmi"]?.value, 21.2)
        XCTAssertEqual(Set(merged[0].sourceIDs), Set([source1, source2]))
        XCTAssertEqual(merged[0].id, history.id)
        let repeated = try MeasurementMerge.merge([full], into: merged)
        XCTAssertEqual(repeated.count, 2)
    }
    func testContradictoryFullReportsDoNotOverwriteAndHistoryCannotDowngrade() throws {
        let date = try XCTUnwrap(ReportDate.parse("2032.04.08 09:10"))
        let full = Measurement(measuredAt: date, kind: .complete,
                               metrics: ["weight": .init(value: 63, confidence: 0.99)], sourceIDs: [UUID()])
        let conflict = Measurement(measuredAt: date, kind: .complete,
                                   metrics: ["weight": .init(value: 65, confidence: 0.99)], sourceIDs: [UUID()])
        XCTAssertThrowsError(try MeasurementMerge.merge([conflict], into: [full]))
        let history = Measurement(measuredAt: date, kind: .history, metrics: conflict.metrics, sourceIDs: [UUID()])
        XCTAssertEqual(try MeasurementMerge.merge([history], into: [full])[0].metrics["weight"]?.value, 63)
    }
    func testSpatialParserKeepsBMIAndPBFSeparateAndExcludesReferenceRanges() throws {
        let report = try ReportParser(document: fixture()).parse(sourceID: UUID())
        XCTAssertEqual(report.current.metrics["weight"]?.value, 65.2)
        XCTAssertEqual(report.current.metrics["muscle"]?.value, 30.8)
        XCTAssertEqual(report.current.metrics["bmi"]?.value, 21.05)
        XCTAssertEqual(report.current.metrics["pbf"]?.value, 18.4)
        XCTAssertEqual(report.current.metrics["weightControl"]?.value, -0.2)
        XCTAssertEqual(report.current.metrics["water"]?.value, 39)
        XCTAssertNil(report.current.metrics["smi"])
        XCTAssertTrue(report.history.isEmpty)
    }
    func testParserRefusesMissingDatesMissingCoreAndConflictingValues() {
        let noDate = fixture(omitDate: true)
        XCTAssertThrowsError(try ReportParser(document: noDate).parse(sourceID: UUID()))
        let missing = fixture(omitMuscle: true)
        XCTAssertThrowsError(try ReportParser(document: missing).parse(sourceID: UUID()))
        let conflict = fixture(weightInTable: 75)
        XCTAssertThrowsError(try ReportParser(document: conflict).parse(sourceID: UUID()))
        let inconsistent = fixture(pbf: 29.2)
        XCTAssertThrowsError(try ReportParser(document: inconsistent).parse(sourceID: UUID()))
    }
    func testLowConfidenceCoreAndAmbiguousChartTicksAreRejected() {
        XCTAssertThrowsError(try ReportParser(document: fixture(coreConfidence: 0.5)).parse(sourceID: UUID()))
        var document = fixture()
        let uncertainTick = number("25.0", x: 0.50, y: 0.575, height: 0.016)
        document = OCRDocument(lines: document.lines, numbers: document.numbers + [uncertainTick])
        XCTAssertThrowsError(try ReportParser(document: document).parse(sourceID: UUID()))
    }
    func testHistoryUsesColumnDatesAndNeverFillsUnprintedMetrics() throws {
        let base = fixture()
        let title = box("人体成分测试历史记录", x: 0.08, y: 0.80)
        let date = box("32.03.09", x: 0.30, y: 0.96, width: 0.04, height: 0.008)
        let time = box("06:20", x: 0.30, y: 0.98, width: 0.04, height: 0.008)
        let values = [number("65.6", x: 0.3025, y: 0.84),
                      number("30.6", x: 0.3025, y: 0.88), number("18.9", x: 0.3025, y: 0.92)]
        let document = OCRDocument(lines: base.lines + [title], numbers: base.numbers + values, dates: [date], times: [time])
        let result = try ReportParser(document: document).parse(sourceID: UUID())
        XCTAssertEqual(result.history.count, 1)
        XCTAssertEqual(Set(result.history[0].metrics.keys), Set(["weight", "muscle", "pbf"]))
        XCTAssertNil(result.history[0].metrics["bmi"])
        XCTAssertEqual(result.history[0].measuredAt, ReportDate.parse("2032.03.09 06:20"))
        let ambiguous = OCRDocument(lines: document.lines, numbers: document.numbers, dates: [date], times: [time, time])
        XCTAssertTrue(try ReportParser(document: ambiguous).parse(sourceID: UUID()).history.isEmpty)
    }
    private func box(_ text: String, x: Double, y: Double, width: Double = 0.15, height: Double = 0.016) -> TextBox {
        TextBox(text: text, confidence: 0.99, x: x, y: y, width: width, height: height)
    }
    private func number(_ text: String, x: Double, y: Double, unit: String? = nil,
                        reference: Bool = false, height: Double = 0.016, confidence: Double = 0.99) -> NumberBox {
        NumberBox(text: text, value: Double(text)!, box: TextBox(text: text, confidence: confidence,
                   x: x, y: y, width: 0.035, height: height), reference: reference, unit: unit)
    }
    // Synthetic OCR coordinates only; these are not the user's photographs or Vision output.
    private func fixture(omitDate: Bool = false, omitMuscle: Bool = false, weightInTable: Double = 65.2,
                         pbf: Double = 18.4, coreConfidence: Double = 0.99) -> OCRDocument {
        var lines = [
            box("人体成分分析", x: 0.08, y: 0.18), box("肌肉脂肪分析", x: 0.08, y: 0.38),
            box("肥胖分析", x: 0.08, y: 0.55), box("肌肉均衡", x: 0.08, y: 0.70),
            box("InBody评分", x: 0.66, y: 0.20), box("体重控制", x: 0.66, y: 0.28),
            box("肥胖评估", x: 0.66, y: 0.38), box("体重控制", x: 0.66, y: 0.32),
            box("身体总水分", x: 0.23, y: 0.23), box("蛋白质", x: 0.23, y: 0.26),
            box("无机盐", x: 0.23, y: 0.29), box("体脂肪", x: 0.23, y: 0.32), box("体重", x: 0.23, y: 0.35)
        ]
        if !omitDate { lines.append(box("2032.04.16 08:35", x: 0.45, y: 0.12, width: 0.19)) }
        var numbers = [
            number("39.0", x: 0.43, y: 0.23, unit: "L"),
            number("10.5", x: 0.43, y: 0.26, unit: "kg"),
            number("3.7", x: 0.43, y: 0.29, unit: "kg"),
            number("12.0", x: 0.43, y: 0.32, unit: "kg"),
            number(String(weightInTable), x: 0.43, y: 0.35, unit: "kg"),
            number("80.0", x: 0.55, y: 0.35, unit: "kg", reference: true),
            number("65.2", x: 0.4, y: 0.43, confidence: coreConfidence),
            number("12.0", x: 0.4, y: 0.51),
            number("21.05", x: 0.4, y: 0.59),
            number(String(pbf), x: 0.4, y: 0.65),
            number("10.0", x: 0.2, y: 0.575, height: 0.008),
            number("85", x: 0.75, y: 0.24, height: 0.03),
            number("100", x: 0.8, y: 0.25, height: 0.012),
            number("-0.2", x: 0.82, y: 0.32, unit: "kg")
        ]
        if !omitMuscle { numbers.append(number("30.8", x: 0.4, y: 0.47)) }
        return OCRDocument(lines: lines, numbers: numbers)
    }
}
