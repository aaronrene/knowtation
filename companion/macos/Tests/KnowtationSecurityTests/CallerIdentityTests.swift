import XCTest
@testable import KnowtationSecurity

final class CallerIdentityTests: XCTestCase {
    private let policy = CallerIdentityPolicy(
        teamIdentifier: "TEAM123456",
        allowedIdentifiers: [
            KnowtationReleaseContract.appIdentifier,
            KnowtationReleaseContract.cliIdentifier,
            KnowtationReleaseContract.mcpIdentifier,
        ]
    )

    func testAcceptsSameTeamAllowedCaller() throws {
        let identity = CallerIdentity(
            identifier: KnowtationReleaseContract.cliIdentifier,
            teamIdentifier: "TEAM123456"
        )
        XCTAssertEqual(try policy.evaluate(identity), identity)
    }

    func testRejectsOtherTeam() {
        XCTAssertThrowsError(try policy.evaluate(CallerIdentity(
            identifier: KnowtationReleaseContract.cliIdentifier,
            teamIdentifier: "ATTACKER00"
        ))) { error in
            XCTAssertEqual(error as? CallerIdentityError, .teamMismatch)
        }
    }

    func testRejectsSameTeamUnknownIdentifier() {
        XCTAssertThrowsError(try policy.evaluate(CallerIdentity(
            identifier: "store.knowtation.substituted",
            teamIdentifier: "TEAM123456"
        ))) { error in
            XCTAssertEqual(error as? CallerIdentityError, .identifierDenied)
        }
    }
}
