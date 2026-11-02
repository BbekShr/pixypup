import AppKit

// Pack Chat, a stand-in for any app with a Dock badge: 1 -> 2 -> 3 every 6 s, quits after 60 s.
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let menu = NSMenu()
let item = NSMenuItem()
menu.addItem(item)
let sub = NSMenu()
sub.addItem(withTitle: "Quit Pack Chat", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
item.submenu = sub
app.mainMenu = menu

var n = 0
Timer.scheduledTimer(withTimeInterval: 6, repeats: true) { _ in
    n += 1
    app.dockTile.badgeLabel = String(n)
}
DispatchQueue.main.asyncAfter(deadline: .now() + 60) { NSApp.terminate(nil) }
app.run()
