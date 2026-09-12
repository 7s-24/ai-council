import AppKit

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
    fputs("usage: IconGenerator output.png\n", stderr)
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

// Three voices around one shared space: original AI Council artwork.
let centers: [NSPoint] = [NSPoint(x: 340, y: 620), NSPoint(x: 684, y: 620), NSPoint(x: 512, y: 340)]
let ring = NSBezierPath()
ring.move(to: centers[0])
ring.line(to: centers[1])
ring.line(to: centers[2])
ring.close()
ring.lineWidth = 36
ring.lineJoinStyle = .round
NSColor.white.withAlphaComponent(0.40).setStroke()
ring.stroke()
for center in centers {
    let rect = NSRect(x: center.x - 102, y: center.y - 82, width: 204, height: 164)
    NSColor.white.setFill()
    NSBezierPath(roundedRect: rect, xRadius: 54, yRadius: 54).fill()
    let tail = NSBezierPath()
    tail.move(to: NSPoint(x: center.x - 45, y: center.y - 65))
    tail.line(to: NSPoint(x: center.x - 45, y: center.y - 111))
    tail.line(to: NSPoint(x: center.x + 13, y: center.y - 65))
    tail.close()
    tail.fill()
}

output.unlockFocus()

guard
    let data = output.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: data),
    let png = bitmap.representation(using: .png, properties: [:])
else { exit(3) }

try png.write(to: URL(fileURLWithPath: arguments[1]))
