# Webstrates file system

Mounts a Webstrate document as a file on disk, propagating changes between the file and document.

Usage:

    node index.js --id=<webstrateId> [--host=<serverHost>]

A folder `documents` should now be created, containing a file named `<webstrateId>`. Open the file in your favourite editor. Any changes made to the Webstrate document will be propagated to the file (as long as the program is running), and likewise any changes made to the file will be converted to OT operations and applied to the document.

NB: Remember to set up your editor to auto-reload the file on changes.
