import AppKit

// Writes a Terminal settings file in the website's dark palette that runs one command when opened.
// usage: terminal-profile <out.terminal> <title> <command>
let args = CommandLine.arguments
guard args.count == 4 else { print("usage: terminal-profile <out.terminal> <title> <command>"); exit(2) }

func rgb(_ hex: Int, _ a: CGFloat = 1) -> Data {
  let c = NSColor(srgbRed: CGFloat(hex >> 16 & 255) / 255, green: CGFloat(hex >> 8 & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
  return try! NSKeyedArchiver.archivedData(withRootObject: c, requiringSecureCoding: false)
}
let font = NSFont(name: "SFMono-Regular", size: 15) ?? NSFont.monospacedSystemFont(ofSize: 15, weight: .regular)

// No coral or orange anywhere but the ANSI reds: the pet finds the failing line by its red pixels.
let profile: [String: Any] = [
  "name": "PixyPup Demo", "type": "Window Settings", "ProfileCurrentVersion": 2.07,
  "BackgroundColor": rgb(0x17131C, 0.97), "TextColor": rgb(0xECE7E2), "TextBoldColor": rgb(0xFFFFFF),
  "CursorColor": rgb(0x8C8794), "SelectionColor": rgb(0x3A3442),
  "ANSIBlackColor": rgb(0x2B2632), "ANSIRedColor": rgb(0xFF4D4D), "ANSIGreenColor": rgb(0x5FD38D),
  "ANSIYellowColor": rgb(0xE8C66B), "ANSIBlueColor": rgb(0x7AA7FF), "ANSIMagentaColor": rgb(0xC79BFF),
  "ANSICyanColor": rgb(0x6FD3D8), "ANSIWhiteColor": rgb(0xD9D4CF),
  "ANSIBrightBlackColor": rgb(0x77717F), "ANSIBrightRedColor": rgb(0xFF6B6B), "ANSIBrightGreenColor": rgb(0x7FE3A6),
  "ANSIBrightYellowColor": rgb(0xF2D58A), "ANSIBrightBlueColor": rgb(0x9BBEFF), "ANSIBrightMagentaColor": rgb(0xD8B6FF),
  "ANSIBrightCyanColor": rgb(0x93E2E6), "ANSIBrightWhiteColor": rgb(0xFFFFFF),
  "Font": try! NSKeyedArchiver.archivedData(withRootObject: font, requiringSecureCoding: false),
  "FontAntialias": true, "UseBrightBold": true, "CursorType": 1, "CursorBlink": false,
  "columnCount": 84, "rowCount": 33,
  "WindowTitle": args[2], "ShowWindowSettingsNameInTitle": false, "ShowActiveProcessInTitle": false,
  "ShowActiveProcessArgumentsInTitle": false, "ShowCommandKeyInTitle": false, "ShowDimensionsInTitle": false,
  "ShowRepresentedURLInTitle": false, "ShowRepresentedURLPathInTitle": false, "ShowShellCommandInTitle": false,
  "ShowTTYNameInTitle": false, "ShowWorkingDirectoryInTitle": false,
  "CommandString": args[3], "RunCommandAsShell": false, "shellExitAction": 2, "warnOnShellCloseAction": 0,
]
let data = try! PropertyListSerialization.data(fromPropertyList: profile, format: .xml, options: 0)
try! data.write(to: URL(fileURLWithPath: args[1]))
