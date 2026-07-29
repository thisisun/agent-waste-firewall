import Foundation
import XCTest
@testable import AWF

final class AppLanguageTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUpWithError() throws {
        suiteName = "AWF.AppLanguageTests.\(UUID().uuidString)"
        defaults = try XCTUnwrap(
            UserDefaults(suiteName: suiteName)
        )
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDownWithError() throws {
        if let suiteName {
            defaults?.removePersistentDomain(forName: suiteName)
        }
        defaults = nil
        suiteName = nil
    }

    func testEnglishIsTheDefaultForMissingOrUnknownPreference() {
        XCTAssertEqual(
            AppLanguagePreference.load(from: defaults),
            .en
        )

        defaults.set("fr", forKey: AppLanguagePreference.key)

        XCTAssertEqual(
            AppLanguagePreference.load(from: defaults),
            .en
        )
    }

    func testEnglishAndKoreanPreferencesPersist() {
        AppLanguagePreference.save(.ko, to: defaults)
        XCTAssertEqual(
            AppLanguagePreference.load(from: defaults),
            .ko
        )

        AppLanguagePreference.save(.en, to: defaults)
        XCTAssertEqual(
            AppLanguagePreference.load(from: defaults),
            .en
        )
    }

    func testSelectedLocalizationBundleProvidesOnlySelectedCopy()
        throws
    {
        let english = try XCTUnwrap(
            AppLocalization.localizedBundle(for: .en)
        )
        let korean = try XCTUnwrap(
            AppLocalization.localizedBundle(for: .ko)
        )

        XCTAssertEqual(
            english.localizedString(
                forKey: "action.quit",
                value: nil,
                table: nil
            ),
            "Quit AWF"
        )
        XCTAssertEqual(
            korean.localizedString(
                forKey: "action.quit",
                value: nil,
                table: nil
            ),
            "AWF 종료"
        )
        XCTAssertEqual(
            AppLocalization.string(
                "action.retry",
                language: .en
            ),
            "Retry Dashboard"
        )
        XCTAssertEqual(
            AppLocalization.string(
                "action.retry",
                language: .ko
            ),
            "대시보드 다시 시작"
        )
    }

    func testEnglishAndKoreanCatalogKeysHaveExactParity() throws {
        let keys = try AppLocalization
            .requireEnglishKoreanKeyParity()

        XCTAssertFalse(keys.isEmpty)
        XCTAssertTrue(keys.contains("app.name"))
        XCTAssertTrue(keys.contains("sentinel.accessibility.label"))
    }

    func testCatalogParityReportsMissingKeysOnBothSides() {
        XCTAssertThrowsError(
            try AppLocalization.requireEnglishKoreanKeyParity(
                english: ["shared", "english.only"],
                korean: ["shared", "korean.only"]
            )
        ) {
            XCTAssertEqual(
                $0 as? AppLocalizationCatalogError,
                .keyMismatch(
                    missingInEnglish: ["korean.only"],
                    missingInKorean: ["english.only"]
                )
            )
        }
    }

    func testBridgeAcceptsOnlyExactEnglishAndKoreanMessages() throws {
        XCTAssertEqual(
            try AppLanguageBridgeMessage(
                body: ["v": 1, "language": "en"]
            ).language,
            .en
        )
        XCTAssertEqual(
            try AppLanguageBridgeMessage(
                body: ["v": 1, "language": "ko"]
            ).language,
            .ko
        )
        XCTAssertEqual(
            try AppLanguageBridgeMessage(
                body: ["v": 1, "language": "ko"]
            ).body["language"] as? String,
            "ko"
        )
    }

    func testBridgeRejectsMissingExtraUnknownAndWrongTypedValues() {
        let invalidMessages: [Any] = [
            ["language": "en"],
            ["v": 1],
            ["v": 1, "language": "en", "extra": true],
            ["v": 2, "language": "en"],
            ["v": true, "language": "en"],
            ["v": 1.5, "language": "en"],
            ["v": 1, "language": "fr"],
            ["v": 1, "language": 1],
            ["v", 1, "language", "en"],
            "not-an-object",
        ]

        for message in invalidMessages {
            XCTAssertThrowsError(
                try AppLanguageBridgeMessage(body: message)
            ) {
                XCTAssertEqual(
                    $0 as? AppLanguageBridgeMessageError,
                    .invalidMessage
                )
            }
        }
    }
}
