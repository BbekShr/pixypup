import Foundation

// TODO(F7): implement via CGWindowListCopyWindowInfo / Accessibility / ScreenCaptureKit.
let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write(Data("usage: pixyhelper windows|badges|capture <windowId>\n".utf8))
    exit(2)
}
switch args[1] {
case "windows", "badges", "capture":
    print("{\"todo\":true}")
default:
    FileHandle.standardError.write(Data("unknown subcommand\n".utf8))
    exit(2)
}
