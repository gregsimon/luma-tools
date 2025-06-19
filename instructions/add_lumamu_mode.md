# Project Overview
Adding separate modes for Luma-1 or Luma-Mu. Currently the web app only supports the Luma-1. Would like to be
swtichable using a combo box at the top to either Luma-1 or Luma-Mu. In this alternative mode (Luma Mu) There are only
8 slots of audio, which are exported as a bank to a ROM file (this function is already implemented)

#  Core Functions
- Two modes: "Luma-1" and "Luma-Mu" changable by a combo box on the top of the page

## applies to both modes
- drag and drop samples between slots
- drag add audio files and .zip files (banks) from the desktop
- Export bank as zip
- export wav from individual voice slot.
- supports naming banks.

## Luma-1 mode
- 10 voice slots named BASS, SNARE, HIHAT, CLAPS, CABASA, TAMB, TOM, CONGA, COWBELL, RIMSHOT
- supports reading and writing individual samples from a connected midi device
- supports reading and writing complete banks to and from a connected midi device.
- supports naming samples, banks
- displays the voice slots as 2 cols, 5 rows in the UI

## Luma-Mu Mode
- 8 voice slots named SLOT 1 .. Slot 8
- no ability to read/ write samples from the hardware. Only export the entire bank as a ROM image
- the bank name becomes the name of the .ROM file when exporting.
- Displays the voice slots as 1 col, 8 rows in the UI

# Docs

# Important Implementation Notes
- use the strategy of hiding/showing certain HTML Ui elements when changing modes. 
- Copy the style of the UI as in index.html and luma.css.
- Files to modify are luma.js, index.html, and luma.css