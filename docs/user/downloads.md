# Downloads

> **Status:** available from 0.1.0-beta.4; the folder of your choice and the question for each file from 0.1.0-beta.5.

Astela saves downloads in the downloads folder of your system, without asking. In the [settings](settings.md#downloads), you can choose another folder, or let Astela ask where to save each file; while the question is open, the download already runs under the name of the file with `.part` added, and canceling the question cancels the download. If a file of the same name is there already, or a running download has the name, the new one gets a number, such as `report (1).pdf`. On Windows and macOS, names that differ only in upper and lower case count as the same name, as they do for the system. On macOS, finished downloads carry the mark of files from the internet, so the system checks them before they open the first time.

With the first download, the toolbar shows the **Downloads** button. While downloads run, a ring around it shows how far they got. The button, `Ctrl+J`, or `Command+Option+L` on macOS, opens the list of your downloads, newest first:

- A running download can be paused, resumed and canceled.
- A finished download can be opened, or shown in its folder.
- A canceled or failed download can be tried again.
- **Remove from list** takes a download off the list; its file stays.
- **Open the downloads folder** opens the folder of downloads in the file manager of your system.

Astela keeps the list for the next start; downloads that still ran when Astela quit are marked as failed.
