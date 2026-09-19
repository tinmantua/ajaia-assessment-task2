# Ajaia TPM Assessment — Task 2

## Exception Data Normalization

This project contains a Node.js script that processes the exception
data supplied in Material 3 of the Ajaia Technical Project Manager
assessment.

The script:

- Normalizes terminal names
- Normalizes carrier codes
- Normalizes timestamp formats
- Identifies records that cannot be confidently cleaned
- Counts exceptions by event type
- Produces a normalized CSV and summary report

## Requirements

- Node.js 18+
- No external dependencies

## Run

```bash
node normalized_exceptions.js exceptions.csv
