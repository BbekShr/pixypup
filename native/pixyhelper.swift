import AppKit
import ApplicationServices
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

// Never prompts for permissions and never writes to disk: the caller (Electron) owns consent.

func emit(_ obj: Any, to fh: FileHandle = .standardOutput) {
    let d = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
    fh.write(d + Data("\n".utf8))
}

func fail(_ code: String) -> Never {
    emit(["error": code], to: .standardError)
    exit(3)
}

func windows() {
    let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
    let out: [[String: Any]] = list.compactMap { w in
        guard (w[kCGWindowLayer as String] as? Int) == 0,
              let id = w[kCGWindowNumber as String] as? Int,
              let b = w[kCGWindowBounds as String] as? [String: Any] else { return nil }
        func n(_ k: String) -> Double { (b[k] as? NSNumber)?.doubleValue ?? 0 }
        return [
            "id": id,
            "pid": w[kCGWindowOwnerPID as String] as? Int ?? 0,
            "owner": w[kCGWindowOwnerName as String] as? String ?? "",
            "title": w[kCGWindowName as String] as? String ?? "",
            "bounds": ["x": n("X"), "y": n("Y"), "w": n("Width"), "h": n("Height")],
        ]
    }
    emit(["windows": out, "titlesRedacted": !CGPreflightScreenCaptureAccess()])
}

func attr(_ el: AXUIElement, _ name: String) -> (AXError, CFTypeRef?) {
    var v: CFTypeRef?
    let e = AXUIElementCopyAttributeValue(el, name as CFString, &v)
    return (e, v)
}

func badges() {
    guard AXIsProcessTrusted(),
          let dock = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock").first
    else { emit(["error": "permission"]); return }
    let app = AXUIElementCreateApplication(dock.processIdentifier)
    let (e, kids) = attr(app, kAXChildrenAttribute)
    if e == .apiDisabled || e == .cannotComplete || e == .notImplemented { emit(["error": "permission"]); return }
    var result: [String: String] = [:]
    for list in (kids as? [AXUIElement]) ?? [] {
        guard (attr(list, kAXRoleAttribute).1 as? String) == kAXListRole else { continue }
        for item in (attr(list, kAXChildrenAttribute).1 as? [AXUIElement]) ?? [] {
            if let t = attr(item, kAXTitleAttribute).1 as? String,
               let s = attr(item, "AXStatusLabel").1 as? String, !s.isEmpty { result[t] = s }
        }
    }
    emit(["badges": result])
}

func capture(_ id: UInt32) async {
    guard CGPreflightScreenCaptureAccess() else { fail("permission") }
    guard let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true) else { fail("permission") }
    guard let win = content.windows.first(where: { $0.windowID == id }) else { fail("nowindow") }
    let scale = NSScreen.screens.first(where: { $0.frame.intersects(win.frame) })?.backingScaleFactor ?? 2
    let cfg = SCStreamConfiguration()
    cfg.width = Int(win.frame.width * scale)
    cfg.height = Int(win.frame.height * scale)
    cfg.showsCursor = false
    guard let img = try? await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: win), configuration: cfg) else { fail("permission") }
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { fail("nowindow") }
    CGImageDestinationAddImage(dest, img, nil)
    guard CGImageDestinationFinalize(dest) else { fail("nowindow") }
    FileHandle.standardOutput.write(data as Data)
    emit(["w": img.width, "h": img.height], to: .standardError)
    exit(0)
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "windows": windows()
case "badges": badges()
case "capture":
    guard args.count > 2, let id = UInt32(args[2]) else { exit(2) }
    Task { await capture(id) }
    DispatchQueue.global().asyncAfter(deadline: .now() + 4) { fail("timeout") }
    dispatchMain()
default:
    FileHandle.standardError.write(Data("usage: pixyhelper windows|badges|capture <windowId>\n".utf8))
    exit(2)
}
