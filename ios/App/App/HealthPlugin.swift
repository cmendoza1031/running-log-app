import Foundation
import Capacitor
import HealthKit

/// Reads daily recovery data from Apple Health: HRV (SDNN), resting HR, and sleep.
/// Read-only. JS name: "VistaHealth" (see client/src/lib/health.ts).
@objc(HealthPlugin)
public class HealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthPlugin"
    public let jsName = "VistaHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readDaily", returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()
    private let hrvType = HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!
    private let rhrType = HKQuantityType.quantityType(forIdentifier: .restingHeartRate)!
    private let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)!

    private var readTypes: Set<HKObjectType> { [hrvType, rhrType, sleepType] }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { return call.reject("Health data not available") }
        store.requestAuthorization(toShare: nil, read: readTypes) { ok, error in
            if let error = error { return call.reject(error.localizedDescription) }
            // HealthKit never reveals whether read access was granted; `ok` only means the sheet completed.
            call.resolve(["completed": ok])
        }
    }

    /// Returns `{ days: [{ date: "YYYY-MM-DD", hrvMs?, restingHr?, sleepMin? }] }` for the last `days` days.
    @objc func readDaily(_ call: CAPPluginCall) {
        let days = max(1, min(call.getInt("days") ?? 60, 120))
        let cal = Calendar.current
        let end = Date()
        let start = cal.date(byAdding: .day, value: -(days - 1), to: cal.startOfDay(for: end))!

        let group = DispatchGroup()
        var hrv: [String: Double] = [:]
        var rhr: [String: Double] = [:]
        var sleep: [String: Double] = [:]

        group.enter()
        dailyAverage(hrvType, unit: .secondUnit(with: .milli), start: start, end: end) { hrv = $0; group.leave() }
        group.enter()
        dailyAverage(rhrType, unit: HKUnit.count().unitDivided(by: .minute()), start: start, end: end) { rhr = $0; group.leave() }
        group.enter()
        sleepMinutes(start: cal.date(byAdding: .hour, value: -12, to: start)!, end: end) { sleep = $0; group.leave() }

        group.notify(queue: .main) {
            let keys = Set(hrv.keys).union(rhr.keys).union(sleep.keys).sorted()
            let out: [[String: Any]] = keys.map { k in
                var d: [String: Any] = ["date": k]
                if let v = hrv[k] { d["hrvMs"] = (v * 10).rounded() / 10 }
                if let v = rhr[k] { d["restingHr"] = Int(v.rounded()) }
                if let v = sleep[k] { d["sleepMin"] = Int(v.rounded()) }
                return d
            }
            call.resolve(["days": out])
        }
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private func dailyAverage(_ type: HKQuantityType, unit: HKUnit, start: Date, end: Date, done: @escaping ([String: Double]) -> Void) {
        let q = HKStatisticsCollectionQuery(
            quantityType: type,
            quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end),
            options: .discreteAverage,
            anchorDate: start,
            intervalComponents: DateComponents(day: 1)
        )
        q.initialResultsHandler = { _, results, _ in
            var out: [String: Double] = [:]
            results?.enumerateStatistics(from: start, to: end) { s, _ in
                if let v = s.averageQuantity()?.doubleValue(for: unit) {
                    out[Self.dayFormatter.string(from: s.startDate)] = v
                }
            }
            done(out)
        }
        store.execute(q)
    }

    /// Minutes asleep per night, keyed by the wake-up date. Overlapping samples from several
    /// sources (Watch + iPhone + apps) are merged so time is not double counted.
    private func sleepMinutes(start: Date, end: Date, done: @escaping ([String: Double]) -> Void) {
        var asleep: Set<Int> = [HKCategoryValueSleepAnalysis.asleep.rawValue] // == asleepUnspecified
        if #available(iOS 16.0, *) {
            asleep.formUnion([
                HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                HKCategoryValueSleepAnalysis.asleepREM.rawValue,
            ])
        }
        let q = HKSampleQuery(
            sampleType: sleepType,
            predicate: HKQuery.predicateForSamples(withStart: start, end: end),
            limit: HKObjectQueryNoLimit,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
        ) { _, samples, _ in
            var byDay: [String: [(Date, Date)]] = [:]
            for case let s as HKCategorySample in samples ?? [] where asleep.contains(s.value) {
                byDay[Self.dayFormatter.string(from: s.endDate), default: []].append((s.startDate, s.endDate))
            }
            var out: [String: Double] = [:]
            for (day, intervals) in byDay {
                var total: TimeInterval = 0
                var cur: (Date, Date)? = nil
                for iv in intervals.sorted(by: { $0.0 < $1.0 }) {
                    if let c = cur, iv.0 <= c.1 {
                        cur = (c.0, max(c.1, iv.1))
                    } else {
                        if let c = cur { total += c.1.timeIntervalSince(c.0) }
                        cur = iv
                    }
                }
                if let c = cur { total += c.1.timeIntervalSince(c.0) }
                if total > 0 { out[day] = total / 60 }
            }
            done(out)
        }
        store.execute(q)
    }
}
