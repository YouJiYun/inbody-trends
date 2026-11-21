import unittest
from select_simulator import choose_device
from check_xcresult import REQUIRED, require_native_tests

class CIToolTests(unittest.TestCase):
    def test_selects_available_iphone_and_latest_installed_runtime(self):
        old = "com.apple.CoreSimulator.SimRuntime.iOS-16-4"
        current = "com.apple.CoreSimulator.SimRuntime.iOS-18-5"
        absent = "com.apple.CoreSimulator.SimRuntime.iOS-19-0"
        runtimes = {"runtimes": [
            {"identifier": old, "version": "16.4", "isAvailable": True},
            {"identifier": current, "version": "18.5", "isAvailable": True},
            {"identifier": absent, "version": "19.0", "isAvailable": False},
        ]}
        def device(name, number, available=True):
            return {"name": name, "udid": f"00000000-0000-4000-8000-{number:012d}",
                    "isAvailable": available, "state": "Shutdown"}
        data = {"devices": {
            old: [device("iPhone Old", 1)], current: [device("iPad", 2), device("iPhone Available", 3), device("iPhone Missing", 4, False)],
            absent: [device("iPhone Future", 5)]
        }}
        winner, version = choose_device(data, runtimes)
        self.assertEqual(winner["name"], "iPhone Available")
        self.assertEqual(version, "18.5")
    def test_missing_supported_runtime_fails_explicitly(self):
        with self.assertRaises(RuntimeError):
            choose_device({"devices": {}}, {"runtimes": []})
    def test_requires_each_native_ocr_test_to_pass(self):
        payload = {"testNodes": [{"name": "SyntheticVisionTests", "nodeType": "Unit test suite",
                   "children": [{"name": method + "()", "nodeType": "Test Case", "result": "Passed"} for method in sorted(REQUIRED)]}]}
        self.assertEqual(require_native_tests(payload), 4)
        payload["testNodes"][0]["children"][0]["result"] = "Skipped"
        with self.assertRaises(RuntimeError):
            require_native_tests(payload)
        payload["testNodes"][0]["children"][0]["result"] = "Failed"
        with self.assertRaises(RuntimeError):
            require_native_tests(payload)
    def test_missing_or_duplicate_native_test_is_not_success(self):
        with self.assertRaises(RuntimeError):
            require_native_tests({"testNodes": []})
        children = [{"name": method + "()", "result": "Passed"} for method in sorted(REQUIRED)]
        children.append(children[0])
        with self.assertRaises(RuntimeError):
            require_native_tests({"testNodes": [{"name": "SyntheticVisionTests", "children": children}]})

if __name__ == "__main__":
    unittest.main()
