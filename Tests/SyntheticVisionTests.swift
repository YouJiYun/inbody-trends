import XCTest
@testable import InBodyTrends

final class SyntheticVisionTests: XCTestCase {
    private func image(_ name: String) throws -> Data {
        let bundle = Bundle(for: Self.self)
        let url = try XCTUnwrap(bundle.resourceURL?.appendingPathComponent("Resources/SyntheticFixtures/\(name).png"))
        guard FileManager.default.fileExists(atPath: url.path) else {
            XCTFail("Missing synthetic image. Run the generator before XCTest; this test must not skip.")
            throw CocoaError(.fileReadNoSuchFile)
        }
        return try Data(contentsOf: url)
    }
    func testSyntheticChineseReportThroughRealVision() async throws {
        let document = try await LocalOCR.recognize(image("clear"))
        XCTAssertFalse(document.lines.isEmpty)
        let parsed = try ReportParser(document: document).parse(sourceID: UUID())
        XCTAssertEqual(parsed.current.measuredAt, ReportDate.parse("2032.04.16 08:35"))
        // Independently specified synthetic oracle, not derived from the rendered image or OCR.
        let expected: [String: Double] = [
            "weight": 74.8, "muscle": 29.6, "fat": 18.7, "bmi": 24.4, "pbf": 25.0,
            "score": 79, "water": 41.2, "protein": 10.8, "minerals": 4.10
        ]
        for (key, value) in expected {
            XCTAssertEqual(try XCTUnwrap(parsed.current.metrics[key]).value, value, accuracy: 0.051, key)
        }
        XCTAssertTrue(parsed.history.isEmpty)
    }
    func testMissingDateImageIsRejectedAfterRealVision() async throws {
        let document = try await LocalOCR.recognize(image("missing-date"))
        XCTAssertFalse(document.lines.isEmpty)
        XCTAssertThrowsError(try ReportParser(document: document).parse(sourceID: UUID())) { error in
            XCTAssertTrue(error.localizedDescription.contains("日期"))
        }
    }
    func testMissingMuscleImageIsRejectedAfterRealVision() async throws {
        let document = try await LocalOCR.recognize(image("missing-muscle"))
        XCTAssertFalse(document.lines.isEmpty)
        XCTAssertThrowsError(try ReportParser(document: document).parse(sourceID: UUID())) { error in
            XCTAssertTrue(error.localizedDescription.contains("条形图"))
        }
    }
    func testContradictoryImageIsRejectedAfterRealVision() async throws {
        let document = try await LocalOCR.recognize(image("conflicting-weight"))
        XCTAssertFalse(document.lines.isEmpty)
        XCTAssertThrowsError(try ReportParser(document: document).parse(sourceID: UUID())) { error in
            XCTAssertTrue(error.localizedDescription.contains("矛盾"))
        }
    }
}
