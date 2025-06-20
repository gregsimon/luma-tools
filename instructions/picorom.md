# Project Overview
Using WebSerial open up a serial connection to the PicoROM and communicate with it. The protocol for talking with the picorom is implemented in a rust library listed below. Please read this file and write the API functions below in pure javascript using the webserial API. 

# Core API
- list number of picoroms connected to the computer and return an array of their names (strings)
- given a binary object, upload this to the picorom


# References docs:
Rust implementation of the protocol is at https://raw.githubusercontent.com/wickerwaka/PicoROM/refs/heads/main/host/picolink/src/lib.rs
- overview of the PicoROM device here: https://github.com/wickerwaka/PicoROM

# Implementation notes
- implement the javascript functions in the file picorom.js, make it all self-contained.
