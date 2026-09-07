import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "src"))
from slug import normalize_slug


class NormalizeSlugTest(unittest.TestCase):
    def test_normalizes_case(self):
        self.assertEqual(normalize_slug("  MorphScope  "), "morphscope")


if __name__ == "__main__":
    unittest.main()
