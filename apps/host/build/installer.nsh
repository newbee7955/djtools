!macro customCheckAppRunning
  # 自定义运行检查：尝试正常关闭一次，遇到无响应/僵尸进程不进行弹窗死循环死锁
  DetailPrint "检查是否有正在运行的实例..."
  !ifdef INSTALL_MODE_PER_ALL_USERS
    nsExec::Exec `taskkill /f /im "${APP_EXECUTABLE_FILENAME}"`
  !else
    nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}"`
  !endif
  Sleep 500
!macroend

!macro customInstall
  # 如果旧 exe 文件被系统驱动或残留句柄锁定，将其移开重命名，确保新二进制提取写入 100% 成功
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 +3
    Rename "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\${APP_EXECUTABLE_FILENAME}.old"
    Delete /REBOOTOK "$INSTDIR\${APP_EXECUTABLE_FILENAME}.old"
!macroend
