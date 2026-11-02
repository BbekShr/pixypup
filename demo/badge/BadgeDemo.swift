import AppKit

// Pack Chat, a stand-in for any app with a Dock badge: a message every 6 s bumps the badge 1 -> 2 -> 3 and
// slides in a banner (top centre, never takes focus) so the video shows why the pet perks up. Quits after 60 s.
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let menu = NSMenu()
let item = NSMenuItem()
menu.addItem(item)
let sub = NSMenu()
sub.addItem(withTitle: "Quit Pack Chat", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
item.submenu = sub
app.mainMenu = menu

let messages = [("Maya R.", "Standup in 5? 🐾"), ("Jordan T.", "Treats PR looks good, shipping it"), ("Maya R.", "Also… pics of Pakkun or it didn't happen")]
let icon = Bundle.main.image(forResource: "chat") ?? NSImage()

func label(_ s: String, _ size: CGFloat, _ weight: NSFont.Weight, _ alpha: CGFloat) -> NSTextField {
    let l = NSTextField(labelWithString: s)
    l.font = .systemFont(ofSize: size, weight: weight)
    l.textColor = NSColor(white: 1, alpha: alpha)
    l.lineBreakMode = .byTruncatingTail
    return l
}

func banner(_ from: String, _ text: String) {
    guard let screen = NSScreen.screens.first else { return }
    let w: CGFloat = 340, h: CGFloat = 72, f = screen.visibleFrame
    // Top centre: the pet's "What Pakkun sees" card owns the top-right corner.
    let panel = NSPanel(contentRect: NSRect(x: f.midX - w / 2, y: f.maxY - h - 10, width: w, height: h), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.level = .statusBar
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary]
    let card = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: w, height: h))
    card.material = .hudWindow
    card.appearance = NSAppearance(named: .darkAqua)
    card.state = .active
    card.wantsLayer = true
    card.layer?.cornerRadius = 16
    card.layer?.masksToBounds = true
    let img = NSImageView(frame: NSRect(x: 14, y: 16, width: 40, height: 40))
    img.image = icon
    let title = label("Pack Chat · \(from)", 13, .semibold, 0.95)
    title.frame = NSRect(x: 66, y: 38, width: w - 80, height: 18)
    let body = label(text, 13, .regular, 0.8)
    body.frame = NSRect(x: 66, y: 16, width: w - 80, height: 18)
    [img, title, body].forEach(card.addSubview)
    panel.contentView = card
    panel.alphaValue = 0
    panel.orderFrontRegardless()
    NSAnimationContext.runAnimationGroup { $0.duration = 0.25; panel.animator().alphaValue = 1 }
    DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
        NSAnimationContext.runAnimationGroup({ $0.duration = 0.4; panel.animator().alphaValue = 0 }) { panel.orderOut(nil) }
    }
}

var n = 0
Timer.scheduledTimer(withTimeInterval: 6, repeats: true) { _ in
    let (from, text) = messages[n % messages.count]
    n += 1
    app.dockTile.badgeLabel = String(n)
    banner(from, text)
}
DispatchQueue.main.asyncAfter(deadline: .now() + 60) { NSApp.terminate(nil) }
app.run()
