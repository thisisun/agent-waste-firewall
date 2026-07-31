import Darwin
import Foundation

let executableURL = NativeHookLauncher.resolvedExecutableURL(
    argumentZero: CommandLine.arguments[0]
)
let status = NativeHookLauncher.run(
    arguments: Array(CommandLine.arguments.dropFirst()),
    executableURL: executableURL,
    environment: ProcessInfo.processInfo.environment
)
Darwin.exit(status)
