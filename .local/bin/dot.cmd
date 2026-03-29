@echo off
git --git-dir="%USERPROFILE%\.dotfiles" --work-tree="%USERPROFILE%" %*
