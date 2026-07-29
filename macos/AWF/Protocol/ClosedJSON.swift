import Foundation

enum PresentationProtocolError: Error, Equatable {
    case responseTooLarge
    case invalidReady
    case invalidStatus
}

enum ClosedJSON {
    static let maximumSafeInteger = 9_007_199_254_740_991

    static func object(
        from data: Data,
        maximumBytes: Int,
        error: PresentationProtocolError
    ) throws -> [String: Any] {
        guard !data.isEmpty, data.count <= maximumBytes else {
            throw data.count > maximumBytes ? .responseTooLarge : error
        }
        let decoded: Any
        do {
            decoded = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw error
        }
        guard let object = decoded as? [String: Any] else {
            throw error
        }
        return object
    }

    static func requireExactKeys(
        _ object: [String: Any],
        _ expected: Set<String>,
        error: PresentationProtocolError
    ) throws {
        guard Set(object.keys) == expected else {
            throw error
        }
    }

    static func string(
        _ value: Any?,
        error: PresentationProtocolError
    ) throws -> String {
        guard let value = value as? String else {
            throw error
        }
        return value
    }

    static func bool(
        _ value: Any?,
        error: PresentationProtocolError
    ) throws -> Bool {
        guard
            let number = value as? NSNumber,
            CFGetTypeID(number) == CFBooleanGetTypeID()
        else {
            throw error
        }
        return number.boolValue
    }

    static func integer(
        _ value: Any?,
        minimum: Int = 0,
        maximum: Int = maximumSafeInteger,
        error: PresentationProtocolError
    ) throws -> Int {
        guard
            let number = value as? NSNumber,
            CFGetTypeID(number) != CFBooleanGetTypeID()
        else {
            throw error
        }
        if CFNumberIsFloatType(number) {
            let floatingPoint = number.doubleValue
            guard
                floatingPoint.isFinite,
                floatingPoint.rounded(.towardZero) == floatingPoint,
                floatingPoint >= Double(minimum),
                floatingPoint <= Double(maximum)
            else {
                throw error
            }
            return Int(floatingPoint)
        }
        let integer = number.int64Value
        guard
            integer >= Int64(minimum),
            integer <= Int64(maximum)
        else {
            throw error
        }
        return Int(integer)
    }

    static func optionalString(
        _ value: Any?,
        error: PresentationProtocolError
    ) throws -> String? {
        if value is NSNull {
            return nil
        }
        return try string(value, error: error)
    }

    static func nestedObject(
        _ value: Any?,
        error: PresentationProtocolError
    ) throws -> [String: Any] {
        guard let object = value as? [String: Any] else {
            throw error
        }
        return object
    }

    static func stringArray(
        _ value: Any?,
        maximumCount: Int,
        allowed: Set<String>,
        error: PresentationProtocolError
    ) throws -> [String] {
        guard let values = value as? [Any], values.count <= maximumCount else {
            throw error
        }
        var result: [String] = []
        var seen = Set<String>()
        for item in values {
            let string = try string(item, error: error)
            guard allowed.contains(string), seen.insert(string).inserted else {
                throw error
            }
            result.append(string)
        }
        return result
    }

    static func hasLowercaseHex(
        _ value: String,
        prefix: String,
        count: Int
    ) -> Bool {
        guard
            value.hasPrefix(prefix),
            value.count == prefix.count + count
        else {
            return false
        }
        return value.dropFirst(prefix.count).allSatisfy {
            ("0"..."9").contains($0) || ("a"..."f").contains($0)
        }
    }
}
