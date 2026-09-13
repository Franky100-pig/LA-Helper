"""Make the project root importable for tests (so `import core` works)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
