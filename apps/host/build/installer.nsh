!macro customCheckAppRunning
  # 自定义运行检查：彻底终止运行中的旧实例与僵尸进程，防止文件被占用导致写入失败
  DetailPrint "检查并关闭可能正在运行的实例..."
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /t`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "doujiao.exe" /t`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "豆角工具箱.exe" /t`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "electron.exe" /t`
  Sleep 500
!macroend

!macro customInstall
  # 安装完成后清理历史残留的临时文件（严禁重命名已释放的新 exe）
  ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}.old"
    Delete /REBOOTOK "$INSTDIR\${APP_EXECUTABLE_FILENAME}.old"
  ${endif}
!macroend

!macro customUnInstall
  # 卸载前先确保进程退出
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /t`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "doujiao.exe" /t`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "豆角工具箱.exe" /t`
!macroend
