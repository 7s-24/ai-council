import AppKit

let arguments = CommandLine.arguments
guard arguments.count == 5 else {
    fputs("usage: IconGenerator claude.svg codex.svg gemini.svg output.png\n", stderr)
    exit(2)
}

let canvas = NSSize(width: 1024, height: 1024)
let output = NSImage(size: canvas)
output.lockFocus()

NSColor.clear.setFill()
NSRect(origin: .zero, size: canvas).fill()

let backgroundRect = NSRect(x: 52, y: 52, width: 920, height: 920)
let background = NSBezierPath(roundedRect: backgroundRect, xRadius: 220, yRadius: 220)
NSGradient(colors: [
    NSColor(calibratedRed: 0.10, green: 0.40, blue: 0.31, alpha: 1),
    NSColor(calibratedRed: 0.20, green: 0.55, blue: 0.42, alpha: 1),
])?.draw(in: background, angle: -45)

let logoPaths = Array(arguments[1...3])
let cardOrigins: [CGFloat] = [132, 387, 642]
for (index, path) in logoPaths.enumerated() {
    let cardRect = NSRect(x: cardOrigins[index], y: 362, width: 250, height: 300)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.18)
    shadow.shadowBlurRadius = 28
    shadow.shadowOffset = NSSize(width: 0, height: -10)
    shadow.set()
    NSColor.white.withAlphaComponent(0.96).setFill()
    NSBezierPath(roundedRect: cardRect, xRadius: 68, yRadius: 68).fill()
    NSGraphicsContext.restoreGraphicsState()

    if let logo = NSImage(contentsOfFile: path) {
        logo.draw(
            in: NSRect(x: cardRect.midX - 70, y: cardRect.midY - 70, width: 140, height: 140),
            from: .zero,
            operation: .sourceOver,
            fraction: 1
        )
    }
}

output.unlockFocus()

guard
    let data = output.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: data),
    let png = bitmap.representation(using: .png, properties: [:])
else { exit(3) }

try png.write(to: URL(fileURLWithPath: arguments[4]))
