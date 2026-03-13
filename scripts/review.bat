@echo off
REM SocyBase Bug Review — local shortcut
REM Usage: scripts\review.bat [--fix] [--files path1 path2]
python "%~dp0bug_review.py" %*
