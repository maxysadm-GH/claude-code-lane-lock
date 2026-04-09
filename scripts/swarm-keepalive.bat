@echo off
REM MBACIO swarm daemon keepalive — Windows Task Scheduler entry.
REM
REM Runs every 5 minutes. Checks if swarm_runner.py is alive; if not, starts it.
REM Prevents overnight dropouts after crashes, reboots, or OOM kills.
REM
REM Registered via schtasks:
REM   schtasks /create /tn "LLMSwarmKeepalive" /tr "~/bin\llm-swarm\keepalive.bat" /sc minute /mo 5 /f
REM
REM Kill switch:
REM   schtasks /change /tn "LLMSwarmKeepalive" /disable

SETLOCAL

SET SWARM_DIR=~/.llm-swarm
SET SWARM_PID=%SWARM_DIR%\swarm.pid
SET SWARM_LOG=%SWARM_DIR%\logs\keepalive.log
SET PYTHON=~/AppData\Local\Programs\Python\Python314\python.exe

REM Ensure log dir exists
if not exist "%SWARM_DIR%\logs" mkdir "%SWARM_DIR%\logs"

echo [%date% %time%] keepalive check >> "%SWARM_LOG%"

REM Read the PID and check if alive
if not exist "%SWARM_PID%" (
    echo [%date% %time%] no PID file, starting daemon >> "%SWARM_LOG%"
    goto START_DAEMON
)

set /p PID=<"%SWARM_PID%"
tasklist /FI "PID eq %PID%" /NH 2>nul | find "python.exe" >nul
if errorlevel 1 (
    echo [%date% %time%] daemon PID %PID% dead, restarting >> "%SWARM_LOG%"
    goto START_DAEMON
)

echo [%date% %time%] daemon PID %PID% alive, OK >> "%SWARM_LOG%"
goto END

:START_DAEMON
cd /d "%SWARM_DIR%"
start /B "" "%PYTHON%" swarm_runner.py --poll-interval 10 >> "%SWARM_DIR%\logs\daemon.log" 2>&1
echo [%date% %time%] daemon started >> "%SWARM_LOG%"

:END
ENDLOCAL
exit /b 0
