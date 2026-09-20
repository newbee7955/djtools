!macro customInit
  # 安装程序启动初始化：彻底终止后台可能仍在运行的旧程序，确保文件句柄释放
  # 严禁使用 /t 参数！若父进程树包含当前安装器，/t 会误杀安装程序自身
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "doujiao.exe"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "豆角工具箱.exe"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "doujiao-remote-input.exe"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "electron.exe"`
  Sleep 1000
!macroend

!macro customCheckAppRunning
  # 自定义运行检查：在释放文件前再次确保旧实例已完全退出
  DetailPrint "检查并关闭可能正在运行的实例..."
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "doujiao.exe"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "豆角工具箱.exe"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "doujiao-remote-input.exe"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "electron.exe"`
  Sleep 800
!macroend

!macro customUnInstallCheck
  # 忽略历史旧版本卸载器的返回值，严禁因历史版本卸载冲突或退出码非0而终止安装
  DetailPrint "旧版本卸载检查完成，继续执行覆盖安装..."
!macroend

!macro customUnInstallCheckCurrentUser
  DetailPrint "旧版本卸载检查完成，继续执行覆盖安装..."
!macroend

!macro customRemoveFiles
  # 自定义清理逻辑：更新场景下避免使用 un.atomicRMDir 移动文件到临时目录导致的文件占用冲突
  ${if} ${isUpdated}
    DetailPrint "准备更新，由新安装程序覆盖文件..."
  ${else}
    DetailPrint "正在清理安装目录..."
    RMDir /r "$INSTDIR"
  ${endif}
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
