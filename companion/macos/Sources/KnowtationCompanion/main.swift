import AppKit
import Foundation
import KnowtationSecurity
import ServiceManagement

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var runtimeStatus = "Starting"

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem.button?.title = "Knowtation"
        installMenu()
        do {
            try SMAppService.agent(
                plistName: KnowtationReleaseContract.custodyLaunchAgentPlist
            ).register()
            runtimeStatus = "Custody ready"
            installMenu()
            startRuntime()
        } catch {
            runtimeStatus = "Setup requires approval"
            installMenu()
        }
    }

    private func startRuntime() {
        Thread.detachNewThread {
            do {
                _ = try RuntimeLauncher(mode: .app).run(arguments: [])
            } catch {
                DispatchQueue.main.async { [weak self] in
                    self?.runtimeStatus = "Runtime unavailable"
                    self?.installMenu()
                }
            }
        }
    }

    private func installMenu() {
        let menu = NSMenu()
        let status = NSMenuItem(title: runtimeStatus, action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Sign In…", action: #selector(signIn), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Sign Out", action: #selector(signOut), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Knowtation", action: #selector(quit), keyEquivalent: "q"))
        statusItem.menu = menu
    }

    @objc private func signIn() {
        runCompanionCommand("sign-in", pending: "Opening browser…", success: "Signed in")
    }

    @objc private func signOut() {
        runCompanionCommand("sign-out", pending: "Signing out…", success: "Signed out")
    }

    private func runCompanionCommand(_ command: String, pending: String, success: String) {
        runtimeStatus = pending
        installMenu()
        Thread.detachNewThread { [weak self] in
            do {
                let status = try RuntimeLauncher(mode: .app).run(
                    arguments: ["companion", command]
                )
                DispatchQueue.main.async {
                    self?.runtimeStatus = status == 0 ? success : "Command failed"
                    self?.installMenu()
                }
            } catch {
                DispatchQueue.main.async {
                    self?.runtimeStatus = "Command failed"
                    self?.installMenu()
                }
            }
        }
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
}

let application = NSApplication.shared
private let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
