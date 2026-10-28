//go:build windows

// HRM-Kassa.exe — start de kassa onzichtbaar op de achtergrond, met een
// pictogram naast de klok (systeemvak).
//
//   - Eerste keer: installeert onderdelen, zet de database klaar en bouwt de kassa
//   - Start de kassa-server verborgen en herstart hem als hij onverwacht stopt
//   - Menu: kassa/beheer openen, adressen + koppelcode, automatisch starten met
//     Windows, bijwerken, logboek, afsluiten
//   - Sluit je het programma (of crasht het), dan stopt de server ook (job object)
//
// Bouwen: zie build.sh (cross-compile vanaf Linux/macOS of `go build` op Windows).
package main

import (
	_ "embed"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"fyne.io/systray"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

//go:embed icon.ico
var iconData []byte

// Antwoord "Ja" van MessageBox (winuser.h)
const idYes = 6

const (
	appName    = "HRM Kassa"
	port       = 3000
	kassaURL   = "http://localhost:3000/kassa"
	beheerURL  = "http://localhost:3000/beheer"
	runKeyPath = `Software\Microsoft\Windows\CurrentVersion\Run`
)

var (
	baseDir string
	logMu   sync.Mutex
	logFile *os.File

	job        windows.Handle // alle kindprocessen; sluiten = alles stopt
	serverMu   sync.Mutex
	serverCmd  *exec.Cmd
	quitting   atomic.Bool
	busy       atomic.Bool // klaarzetten of bijwerken bezig
	openedOnce atomic.Bool
)

func main() {
	exe, err := os.Executable()
	if err != nil {
		fatal("Kan de programmamap niet bepalen: " + err.Error())
	}
	baseDir = filepath.Dir(exe)
	if err := os.Chdir(baseDir); err != nil {
		fatal("Kan niet naar de programmamap: " + err.Error())
	}

	// Maar één keer tegelijk: draait hij al, open dan alleen de kassa
	name, _ := windows.UTF16PtrFromString(`Local\HRMKassaLauncher`)
	if _, err := windows.CreateMutex(nil, false, name); errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		openURL(kassaURL)
		return
	}

	openLog()
	logf("=== %s gestart vanuit %s ===", appName, baseDir)
	setupJob()
	systray.Run(onReady, onExit)
}

// ---------------------------------------------------------------- systeemvak

func onReady() {
	systray.SetIcon(iconData)
	systray.SetTitle(appName)
	systray.SetTooltip(appName + " – opstarten…")

	mOpen := systray.AddMenuItem("Kassa openen", "Open het kassascherm")
	mBeheer := systray.AddMenuItem("Beheer openen", "Producten, medewerkers, instellingen")
	mInfo := systray.AddMenuItem("Adressen en koppelcode…", "Voor telefoons en het koppelen van de kassa")
	systray.AddSeparator()
	mAuto := systray.AddMenuItemCheckbox("Automatisch starten met Windows", "", autostartEnabled())
	mUpdate := systray.AddMenuItem("Bijwerken naar nieuwste versie", "Haalt de nieuwste versie op (maakt eerst een backup)")
	mLog := systray.AddMenuItem("Logboek openen", "")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("Kassa afsluiten", "Stopt de kassa (ook voor de telefoons)")

	systray.SetOnTapped(func() { openURL(kassaURL) })

	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				openURL(kassaURL)
			case <-mBeheer.ClickedCh:
				openURL(beheerURL)
			case <-mInfo.ClickedCh:
				go showInfo()
			case <-mAuto.ClickedCh:
				if mAuto.Checked() {
					if err := setAutostart(false); err != nil {
						go messageBox("Automatisch starten uitzetten mislukt: "+err.Error(), windows.MB_ICONERROR)
					} else {
						mAuto.Uncheck()
					}
				} else {
					if err := setAutostart(true); err != nil {
						go messageBox("Automatisch starten aanzetten mislukt: "+err.Error(), windows.MB_ICONERROR)
					} else {
						mAuto.Check()
					}
				}
			case <-mUpdate.ClickedCh:
				go update()
			case <-mLog.ClickedCh:
				startHidden("notepad.exe", filepath.Join(baseDir, "logs", "kassa.log"))
			case <-mQuit.ClickedCh:
				go func() {
					if messageBox("Kassa afsluiten?\n\nDe kassa en de telefoons werken dan niet meer tot je HRM-Kassa.exe opnieuw start.", windows.MB_YESNO|windows.MB_ICONQUESTION) == idYes {
						systray.Quit()
					}
				}()
			}
		}
	}()

	go func() {
		if err := prepare(); err != nil {
			systray.SetTooltip(appName + " – fout bij opstarten (zie logboek)")
			messageBox("De kassa kon niet worden gestart:\n\n"+err.Error()+"\n\nOpen via het kassa-icoon het logboek, of stuur het bestand logs\\kassa.log door.", windows.MB_ICONERROR)
			return
		}
		superviseServer()
	}()
}

func onExit() {
	quitting.Store(true)
	stopServer()
	if job != 0 {
		windows.CloseHandle(job)
	}
	logf("=== afgesloten ===")
}

// ---------------------------------------------------------------- klaarzetten

func nodePath() (string, error) {
	if p, err := exec.LookPath("node.exe"); err == nil {
		return p, nil
	}
	for _, dir := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs")} {
		p := filepath.Join(dir, "nodejs", "node.exe")
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", errors.New("Node.js is niet gevonden. Installeer de LTS-versie van https://nodejs.org en start HRM-Kassa.exe opnieuw")
}

func exists(rel string) bool {
	_, err := os.Stat(filepath.Join(baseDir, rel))
	return err == nil
}

// prepare zet alles klaar wat nodig is voordat de server kan starten.
func prepare() error {
	busy.Store(true)
	defer busy.Store(false)
	node, err := nodePath()
	if err != nil {
		openURL("https://nodejs.org")
		return err
	}
	if !exists("package.json") {
		return errors.New("HRM-Kassa.exe moet in de kassamap staan (naast package.json)")
	}
	steps := []struct {
		when bool
		tip  string
		name string
		args []string
	}{
		{true, "instellingen controleren", node, []string{"scripts/setup.mjs"}},
		{!exists(`node_modules\.package-lock.json`), "onderdelen installeren (eenmalig, enkele minuten)", "cmd.exe", []string{"/c", "npm", "ci", "--no-audit", "--no-fund"}},
		{true, "database bijwerken", node, []string{`node_modules\prisma\build\index.js`, "migrate", "deploy"}},
		{true, "basisgegevens controleren", node, []string{`node_modules\prisma\build\index.js`, "db", "seed"}},
		{!exists(`.next\BUILD_ID`), "kassa klaarzetten (eenmalig, 1 à 2 minuten)", node, []string{`node_modules\next\dist\bin\next`, "build"}},
	}
	for _, s := range steps {
		if !s.when {
			continue
		}
		systray.SetTooltip(appName + " – " + s.tip + "…")
		logf("> %s %s", s.name, strings.Join(s.args, " "))
		if err := runStep(s.name, s.args...); err != nil {
			return fmt.Errorf("%s mislukt: %w", s.tip, err)
		}
	}
	return nil
}

func runStep(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = baseDir
	cmd.Env = os.Environ()
	cmd.Stdout = logWriter{}
	cmd.Stderr = logWriter{}
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	if err := cmd.Start(); err != nil {
		return err
	}
	addToJob(cmd.Process.Pid)
	return cmd.Wait()
}

// ---------------------------------------------------------------- server

func portFree() bool {
	l, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return false
	}
	l.Close()
	return true
}

func superviseServer() {
	var crashes []time.Time
	for !quitting.Load() {
		if busy.Load() {
			time.Sleep(time.Second)
			continue
		}
		if !portFree() {
			if healthy() {
				// Draait al (bijv. nog via start.bat): niets doen, alleen openen
				systray.SetTooltip(appName + " – draait (gestart via start.bat?)")
				if openedOnce.CompareAndSwap(false, true) {
					openURL(kassaURL)
				}
				time.Sleep(10 * time.Second)
				continue
			}
			systray.SetTooltip(appName + " – poort 3000 is bezet")
			messageBox("Poort 3000 is al in gebruik door een ander programma. Sluit dat programma (of start.bat) en start HRM-Kassa.exe opnieuw.", windows.MB_ICONWARNING)
			systray.Quit()
			return
		}

		node, err := nodePath()
		if err != nil {
			messageBox(err.Error(), windows.MB_ICONERROR)
			return
		}
		cmd := exec.Command(node, `node_modules\next\dist\bin\next`, "start", "-H", "0.0.0.0", "-p", fmt.Sprint(port))
		cmd.Dir = baseDir
		cmd.Env = append(os.Environ(), "NODE_ENV=production")
		cmd.Stdout = logWriter{}
		cmd.Stderr = logWriter{}
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
		logf("> server starten")
		if err := cmd.Start(); err != nil {
			messageBox("Server starten mislukt: "+err.Error(), windows.MB_ICONERROR)
			return
		}
		addToJob(cmd.Process.Pid)
		serverMu.Lock()
		serverCmd = cmd
		serverMu.Unlock()

		go func() {
			for i := 0; i < 120 && !quitting.Load(); i++ {
				if healthy() {
					systray.SetTooltip(appName + " – draait. Klik om de kassa te openen")
					if openedOnce.CompareAndSwap(false, true) {
						openURL(kassaURL)
					}
					return
				}
				time.Sleep(time.Second)
			}
		}()

		err = cmd.Wait()
		serverMu.Lock()
		serverCmd = nil
		serverMu.Unlock()
		if quitting.Load() || busy.Load() {
			continue
		}
		logf("! server gestopt: %v — opnieuw starten", err)
		systray.SetTooltip(appName + " – herstarten…")
		now := time.Now()
		crashes = append(crashes, now)
		recent := crashes[:0]
		for _, t := range crashes {
			if now.Sub(t) < 5*time.Minute {
				recent = append(recent, t)
			}
		}
		crashes = recent
		if len(crashes) >= 5 {
			systray.SetTooltip(appName + " – gestopt (zie logboek)")
			messageBox("De kassa-server stopt steeds onverwacht. Open het logboek via het kassa-icoon en stuur het door.", windows.MB_ICONERROR)
			return
		}
		time.Sleep(3 * time.Second)
	}
}

func healthy() bool {
	client := http.Client{Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/koppelen", port))
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode < 500
}

func stopServer() {
	serverMu.Lock()
	cmd := serverCmd
	serverMu.Unlock()
	if cmd != nil && cmd.Process != nil {
		// Hele procesboom stoppen (next start start zelf ook processen)
		kill := exec.Command("taskkill.exe", "/PID", fmt.Sprint(cmd.Process.Pid), "/T", "/F")
		kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
		_ = kill.Run()
	}
	for i := 0; i < 20; i++ {
		serverMu.Lock()
		gone := serverCmd == nil
		serverMu.Unlock()
		if gone {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// ---------------------------------------------------------------- bijwerken

func update() {
	if !busy.CompareAndSwap(false, true) {
		messageBox("Er wordt al iets klaargezet of bijgewerkt. Even geduld.", windows.MB_ICONINFORMATION)
		return
	}
	defer busy.Store(false)
	if messageBox("De kassa bijwerken naar de nieuwste versie?\n\nDe kassa is hierdoor 1 à 3 minuten niet beschikbaar. Er wordt eerst een backup gemaakt.", windows.MB_YESNO|windows.MB_ICONQUESTION) != idYes {
		return
	}
	if _, err := exec.LookPath("git.exe"); err != nil || !exists(".git") {
		messageBox("Bijwerken kan alleen als de kassa met Git is geïnstalleerd (git clone). Installeer Git van https://git-scm.com.", windows.MB_ICONWARNING)
		return
	}
	node, err := nodePath()
	if err != nil {
		messageBox(err.Error(), windows.MB_ICONERROR)
		return
	}
	systray.SetTooltip(appName + " – bijwerken…")
	stopServer()

	// Backup van de database
	if exists(`prisma\kassa.db`) {
		_ = os.MkdirAll(filepath.Join(baseDir, "backups"), 0o755)
		dst := filepath.Join(baseDir, "backups", "voor-update_"+time.Now().Format("2006-01-02_150405")+".db")
		if err := copyFile(filepath.Join(baseDir, `prisma\kassa.db`), dst); err != nil {
			logf("! backup mislukt: %v", err)
			messageBox("Backup maken mislukt, bijwerken afgebroken: "+err.Error(), windows.MB_ICONERROR)
			return
		}
	}

	steps := [][]string{
		{"git.exe", "pull", "--ff-only"},
		{"cmd.exe", "/c", "npm", "ci", "--no-audit", "--no-fund"},
		{node, `node_modules\prisma\build\index.js`, "migrate", "deploy"},
		{node, `node_modules\next\dist\bin\next`, "build"},
	}
	for _, s := range steps {
		logf("> %s", strings.Join(s, " "))
		if err := runStep(s[0], s[1:]...); err != nil {
			messageBox(fmt.Sprintf("Bijwerken mislukt bij \"%s\": %v\n\nDe kassa start weer met de vorige versie. Zie het logboek.", strings.Join(s[1:], " "), err), windows.MB_ICONERROR)
			return
		}
	}
	logf("bijwerken klaar")
	go messageBox("De kassa is bijgewerkt en start opnieuw. Ververs het kassascherm in de browser (F5).", windows.MB_ICONINFORMATION)
}

// ---------------------------------------------------------------- info

func showInfo() {
	code := "(onbekend)"
	if data, err := os.ReadFile(filepath.Join(baseDir, ".env")); err == nil {
		if m := regexp.MustCompile(`(?m)^PAIRING_CODE="?(\d+)"?`).FindSubmatch(data); m != nil {
			code = string(m[1])
		}
	}
	var lines []string
	lines = append(lines, "Kassa (deze pc):   "+kassaURL, "")
	for _, ip := range lanIPs() {
		lines = append(lines, fmt.Sprintf("Telefoons:   http://%s:%d/telefoon", ip, port))
	}
	lines = append(lines, "", "Koppelcode:   "+code, "", "Beheer:   "+beheerURL)
	messageBox(strings.Join(lines, "\n"), windows.MB_ICONINFORMATION)
}

func lanIPs() []string {
	var out []string
	ifaces, _ := net.Interfaces()
	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && ipn.IP.IsPrivate() {
				out = append(out, ipn.IP.String())
			}
		}
	}
	return out
}

// ---------------------------------------------------------------- autostart

func autostartEnabled() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	_, _, err = k.GetStringValue(appName)
	return err == nil
}

func setAutostart(on bool) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if !on {
		if err := k.DeleteValue(appName); err != nil && !errors.Is(err, registry.ErrNotExist) {
			return err
		}
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return k.SetStringValue(appName, `"`+exe+`"`)
}

// ---------------------------------------------------------------- hulpfuncties

func setupJob() {
	h, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		logf("! job object: %v", err)
		return
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(h, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		logf("! job object instellen: %v", err)
		windows.CloseHandle(h)
		return
	}
	job = h
}

func addToJob(pid int) {
	if job == 0 {
		return
	}
	p, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return
	}
	defer windows.CloseHandle(p)
	_ = windows.AssignProcessToJobObject(job, p)
}

func openURL(url string) {
	startHidden("rundll32.exe", "url.dll,FileProtocolHandler", url)
}

func startHidden(name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Start()
}

func messageBox(text string, flags uint32) int32 {
	t, _ := windows.UTF16PtrFromString(text)
	c, _ := windows.UTF16PtrFromString(appName)
	r, _ := windows.MessageBox(0, t, c, flags|windows.MB_SETFOREGROUND|windows.MB_TOPMOST)
	return r
}

func fatal(text string) {
	messageBox(text, windows.MB_ICONERROR)
	os.Exit(1)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// ---------------------------------------------------------------- logboek

func openLog() {
	dir := filepath.Join(baseDir, "logs")
	_ = os.MkdirAll(dir, 0o755)
	path := filepath.Join(dir, "kassa.log")
	if st, err := os.Stat(path); err == nil && st.Size() > 5*1024*1024 {
		_ = os.Rename(path, filepath.Join(dir, "kassa.vorige.log"))
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err == nil {
		logFile = f
	}
}

func logf(format string, args ...any) {
	logMu.Lock()
	defer logMu.Unlock()
	if logFile != nil {
		fmt.Fprintf(logFile, "%s %s\r\n", time.Now().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, args...))
	}
}

type logWriter struct{}

func (logWriter) Write(p []byte) (int, error) {
	logMu.Lock()
	defer logMu.Unlock()
	if logFile != nil {
		_, _ = logFile.Write(p)
	}
	return len(p), nil
}
