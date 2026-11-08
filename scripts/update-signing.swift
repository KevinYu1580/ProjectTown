#!/usr/bin/env swift
// Ed25519 keys and signatures for in-app updates (see UpdateSignature in ProjectTownCore).
//   update-signing.swift generate <private-key-file>  writes a new private key (base64) and prints the public key
//   update-signing.swift sign <zip>                    prints the zip's signature; the key comes from $UPDATE_SIGNING_KEY
import CryptoKit
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let args = CommandLine.arguments.dropFirst()
switch (args.first, args.count) {
case ("generate", 2):
    let path = args.last!
    guard !FileManager.default.fileExists(atPath: path) else { fail("\(path) already exists") }
    let key = Curve25519.Signing.PrivateKey()
    let text = key.rawRepresentation.base64EncodedString() + "\n"
    guard FileManager.default.createFile(atPath: path, contents: Data(text.utf8), attributes: [.posixPermissions: 0o600]) else {
        fail("cannot write \(path)")
    }
    print(key.publicKey.rawRepresentation.base64EncodedString())
case ("sign", 2):
    guard let encoded = ProcessInfo.processInfo.environment["UPDATE_SIGNING_KEY"],
          let raw = Data(base64Encoded: encoded.trimmingCharacters(in: .whitespacesAndNewlines)),
          let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw) else { fail("UPDATE_SIGNING_KEY is missing or invalid") }
    guard let zip = FileManager.default.contents(atPath: args.last!) else { fail("cannot read \(args.last!)") }
    print(try key.signature(for: zip).base64EncodedString())
default:
    fail("usage: update-signing.swift generate <private-key-file> | sign <zip>")
}
