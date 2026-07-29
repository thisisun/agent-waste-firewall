import XCTest

@MainActor
final class AWFUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testApplicationLaunchesAndMainWindowCanCloseWithoutTermination() {
        let app = XCUIApplication()
        defer {
            app.terminate()
        }
        app.launch()

        let window = app.windows["AWF"]
        XCTAssertTrue(window.waitForExistence(timeout: 8))

        let retry = app.buttons["awf.retry"].firstMatch
        XCTAssertTrue(retry.waitForExistence(timeout: 5))

        let close = window.buttons[XCUIIdentifierCloseWindow]
        XCTAssertTrue(close.exists)
        close.click()

        let closed = expectation(
            for: NSPredicate(format: "exists == false"),
            evaluatedWith: window
        )
        wait(for: [closed], timeout: 3)
        XCTAssertFalse(window.exists)
        XCTAssertNotEqual(app.state, .notRunning)
    }
}
