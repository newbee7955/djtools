!macro customCheckAppRunning
  # 自定义运行检查：彻底终止运行中的旧实例与僵尸进程，防止文件被占用导致写入失败
  # 注意：严禁添加 /t 参数！在线更新时安装程序是由旧版 doujiao.exe 拉起的子进程，
  # 若使用 /t 会遍历进程树杀死父进程的所有子进程，导致安装程序自身被误杀闪退！
  DetailPrint "检查并关闭可能正在运行的实例..."
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "doujiao.exe"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "豆角工具箱.exe"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "doujiao-remote-input.exe"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "electron.exe"`
  Sleep 800
!macroend

!macro customInstall
  # 安装完成后清理历史残留的临时文件（严禁重命名已释放的新 exe）
  ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}.old"
    Delete /REBOOTOK "$INSTDIR\${APP_EXECUTABLE_FILENAME}.old"
  ${endif}
!macroend

!macro customUnInstall
  # 卸载前先确保进程退出（严禁使用 /t 参数）
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "doujiao.exe"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "豆角工具箱.exe"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "doujiao-remote-input.exe"`
  Sleep 500
!macroend
