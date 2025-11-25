use std::io;
use windows::Win32::Foundation::{HANDLE, CloseHandle};
use windows::Win32::Storage::FileSystem::{ReadFile, WriteFile};
use windows::Win32::System::Console::{
    CreatePseudoConsole, ResizePseudoConsole, ClosePseudoConsole, COORD, HPCON,
};
use windows::Win32::System::Pipes::{CreatePipe, PeekNamedPipe};
use windows::Win32::System::Threading::{
    CreateProcessW, PROCESS_INFORMATION, STARTUPINFOEXW, InitializeProcThreadAttributeList,
    UpdateProcThreadAttribute, DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT,
    PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, LPPROC_THREAD_ATTRIBUTE_LIST,
};

pub struct WindowsPty {
    console: HPCON,
    input_write: HANDLE,
    output_read: HANDLE,
    process_handle: HANDLE,
    attribute_list_buffer: Vec<u8>,
}

impl WindowsPty {
    pub fn new(cols: u16, rows: u16) -> io::Result<Self> {
        unsafe {
            // Create pipes for console I/O
            let mut input_read: HANDLE = HANDLE::default();
            let mut input_write: HANDLE = HANDLE::default();
            let mut output_read: HANDLE = HANDLE::default();
            let mut output_write: HANDLE = HANDLE::default();

            CreatePipe(&mut input_read, &mut input_write, None, 0)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("Failed to create input pipe: {}", e)))?;

            CreatePipe(&mut output_read, &mut output_write, None, 0)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("Failed to create output pipe: {}", e)))?;

            // Create the pseudo console
            let coord = COORD { X: cols as i16, Y: rows as i16 };
            let console = CreatePseudoConsole(coord, input_read, output_write, 0)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("Failed to create pseudo console: {}", e)))?;

            // Close the handles that are owned by the console
            let _ = CloseHandle(input_read);
            let _ = CloseHandle(output_write);

            // Create startup info for the process
            let mut startup_info = Box::new(std::mem::zeroed::<STARTUPINFOEXW>());
            startup_info.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;

            // Initialize the attribute list
            let mut size: usize = 0;
            let _ = InitializeProcThreadAttributeList(LPPROC_THREAD_ATTRIBUTE_LIST::default(), 1, 0, &mut size);

            let mut attribute_list_buffer = vec![0u8; size];
            let lpAttributeList = LPPROC_THREAD_ATTRIBUTE_LIST(attribute_list_buffer.as_mut_ptr() as *mut _);

            InitializeProcThreadAttributeList(lpAttributeList, 1, 0, &mut size)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("Failed to initialize attribute list: {}", e)))?;

            startup_info.lpAttributeList = lpAttributeList;

            // Update the attribute list with the pseudo console
            UpdateProcThreadAttribute(
                lpAttributeList,
                0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
                Some(&console as *const _ as *const _),
                std::mem::size_of::<HPCON>(),
                None,
                None,
            )
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("Failed to update attribute: {}", e)))?;

            // Spawn cmd.exe (works better with ConPTY than PowerShell)
            let cmdline = "cmd.exe\0";
            let mut cmdline_wide: Vec<u16> = cmdline.encode_utf16().collect();

            let mut process_info: PROCESS_INFORMATION = std::mem::zeroed();

            CreateProcessW(
                None,
                windows::core::PWSTR(cmdline_wide.as_mut_ptr()),
                None,
                None,
                false,
                EXTENDED_STARTUPINFO_PRESENT,
                None,
                None,
                &startup_info.StartupInfo,
                &mut process_info,
            )
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("Failed to create process: {}", e)))?;

            // Clean up the attribute list (but keep the buffer alive)
            DeleteProcThreadAttributeList(lpAttributeList);

            // Close thread handle (not needed), but KEEP process handle alive
            let _ = CloseHandle(process_info.hThread);

            Ok(WindowsPty {
                console,
                input_write,
                output_read,
                process_handle: process_info.hProcess,
                attribute_list_buffer,
            })
        }
    }

    pub fn read(&self, buf: &mut [u8]) -> io::Result<usize> {
        unsafe {
            // Use PeekNamedPipe to check if data is available (non-blocking)
            let mut bytes_avail: u32 = 0;
            match PeekNamedPipe(
                self.output_read,
                None,
                0,
                None,
                Some(&mut bytes_avail),
                None,
            ) {
                Ok(_) => {
                    if bytes_avail == 0 {
                        // No data available, return WouldBlock
                        return Err(io::Error::new(io::ErrorKind::WouldBlock, "No data available"));
                    }
                    // Data is available, proceed with read
                },
                Err(e) => {
                    return Err(io::Error::new(io::ErrorKind::Other, format!("Peek failed: {}", e)));
                }
            }

            let mut bytes_read: u32 = 0;
            match ReadFile(
                self.output_read,
                Some(buf),
                Some(&mut bytes_read),
                None,
            ) {
                Ok(_) => {
                    Ok(bytes_read as usize)
                },
                Err(e) => {
                    if bytes_read > 0 {
                        Ok(bytes_read as usize)
                    } else {
                        Err(io::Error::new(io::ErrorKind::Other, format!("Read failed: {}", e)))
                    }
                }
            }
        }
    }

    pub fn write(&self, buf: &[u8]) -> io::Result<()> {
        unsafe {
            let mut bytes_written: u32 = 0;

            WriteFile(
                self.input_write,
                Some(buf),
                Some(&mut bytes_written),
                None,
            )
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("Write failed: {}", e)))?;

            Ok(())
        }
    }

    pub fn resize(&self, cols: u16, rows: u16) -> io::Result<()> {
        unsafe {
            let coord = COORD { X: cols as i16, Y: rows as i16 };
            ResizePseudoConsole(self.console, coord)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("Resize failed: {}", e)))?;
            Ok(())
        }
    }
}

impl Drop for WindowsPty {
    fn drop(&mut self) {
        unsafe {
            let _ = ClosePseudoConsole(self.console);
            let _ = CloseHandle(self.input_write);
            let _ = CloseHandle(self.output_read);
            let _ = CloseHandle(self.process_handle);
        }
    }
}

// Ensure WindowsPty is Send
unsafe impl Send for WindowsPty {}
