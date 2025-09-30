;; IncentiveProgram.cl
;; Core contract for managing individual incentive programs in EcoIncentives.
;; Handles program creation, participant management, commitment tracking,
;; proof verification, reward claiming, program lifecycle, and governance elements.
;; Designed for robustness with error handling, events, and integration points.

;; Traits and Constants
(use-trait oracle-trait .verification-oracle.oracle-trait)
(use-trait token-trait .green-token.token-trait)
(use-trait distributor-trait .reward-distributor.distributor-trait)

(define-constant ERR-UNAUTHORIZED (err u100))
(define-constant ERR-PROGRAM-NOT-FOUND (err u101))
(define-constant ERR-ALREADY-JOINED (err u102))
(define-constant ERR-NOT-VERIFIED (err u103))
(define-constant ERR-ALREADY-VERIFIED (err u104))
(define-constant ERR-INVALID-PROOF (err u105))
(define-constant ERR-PROGRAM-EXPIRED (err u106))
(define-constant ERR-INSUFFICIENT-BUDGET (err u107))
(define-constant ERR-INVALID-AMOUNT (err u108))
(define-constant ERR-NOT-ADMIN (err u109))
(define-constant ERR-PAUSED (err u110))
(define-constant ERR-INVALID-PARAM (err u111))
(define-constant ERR-ALREADY-EXISTS (err u112))
(define-constant ERR-NOT-STARTED (err u113))

(define-constant MAX-COMMITMENT-LEN u256)
(define-constant MAX-PROOF-LEN u512)
(define-constant MAX-TAGS u10)

;; Data Variables
(define-data-var contract-admin principal tx-sender)
(define-data-var paused bool false)
(define-data-var program-counter uint u0)

;; Data Maps
(define-map programs
  uint  ;; program-id
  {
    name: (string-ascii 64),
    description: (string-utf8 512),
    admin: principal,
    budget: uint,
    reward-per-user: uint,
    start-block: uint,
    end-block: uint,
    active: bool,
    verified-count: uint,
    total-participants: uint,
    tags: (list 10 (string-ascii 32)),
    required-commitment-type: (string-ascii 32)  ;; e.g., "trees-planted", "emissions-reduced"
  }
)

(define-map participants
  { program-id: uint, user: principal }
  {
    commitment: (buff 256),  ;; Hashed or encoded commitment data
    join-block: uint,
    verified: bool,
    verification-block: (optional uint),
    reward-claimed: bool,
    proof-submitted: bool
  }
)

(define-map proofs
  { program-id: uint, user: principal }
  {
    proof-data: (buff 512),
    submission-block: uint,
    oracle-verified: bool,
    verification-notes: (optional (string-utf8 256))
  }
)

(define-map rewards-history
  { program-id: uint, user: principal }
  {
    amount: uint,
    claim-block: uint
  }
)

;; Private Functions
(define-private (is-admin (caller principal))
  (is-eq caller (var-get contract-admin))
)

(define-private (is-program-admin (program-id uint) (caller principal))
  (match (map-get? programs program-id)
    program (is-eq (get admin program) caller)
    false
  )
)

(define-private (get-current-block)
  block-height
)

(define-private (validate-program-active (program-id uint))
  (match (map-get? programs program-id)
    program
    (if (and (get active program)
             (>= (get-current-block) (get start-block program))
             (<= (get-current-block) (get end-block program)))
      (ok true)
      (if (> (get-current-block) (get end-block program))
        ERR-PROGRAM-EXPIRED
        ERR-NOT-STARTED
      ))
    ERR-PROGRAM-NOT-FOUND
  )
)

;; Public Functions
(define-public (create-program
  (name (string-ascii 64))
  (description (string-utf8 512))
  (budget uint)
  (reward-per-user uint)
  (duration-blocks uint)
  (tags (list 10 (string-ascii 32)))
  (commitment-type (string-ascii 32)))
  (let
    (
      (caller tx-sender)
      (current-block (get-current-block))
      (new-id (+ (var-get program-counter) u1))
    )
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (> budget u0) ERR-INVALID-AMOUNT)
    (asserts! (> reward-per-user u0) ERR-INVALID-AMOUNT)
    (asserts! (> duration-blocks u0) ERR-INVALID-PARAM)
    (asserts! (<= (len tags) MAX-TAGS) ERR-INVALID-PARAM)
    (map-set programs new-id
      {
        name: name,
        description: description,
        admin: caller,
        budget: budget,
        reward-per-user: reward-per-user,
        start-block: current-block,
        end-block: (+ current-block duration-blocks),
        active: true,
        verified-count: u0,
        total-participants: u0,
        tags: tags,
        required-commitment-type: commitment-type
      }
    )
    (var-set program-counter new-id)
    (print { event: "program-created", id: new-id, admin: caller })
    (ok new-id)
  )
)

(define-public (join-program (program-id uint) (commitment (buff 256)))
  (let
    (
      (caller tx-sender)
      (key { program-id: program-id, user: caller })
    )
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (try! (validate-program-active program-id))
    (asserts! (is-none (map-get? participants key)) ERR-ALREADY-JOINED)
    (asserts! (<= (len commitment) MAX-COMMITMENT-LEN) ERR-INVALID-PARAM)
    (map-set participants key
      {
        commitment: commitment,
        join-block: (get-current-block),
        verified: false,
        verification-block: none,
        reward-claimed: false,
        proof-submitted: false
      }
    )
    (map-set programs program-id
      (merge (unwrap-panic (map-get? programs program-id))
        { total-participants: (+ (get total-participants (unwrap-panic (map-get? programs program-id))) u1) }
      )
    )
    (print { event: "joined-program", program-id: program-id, user: caller })
    (ok true)
  )
)

(define-public (submit-proof (program-id uint) (proof-data (buff 512)) (notes (optional (string-utf8 256))))
  (let
    (
      (caller tx-sender)
      (key { program-id: program-id, user: caller })
      (participant (unwrap! (map-get? participants key) ERR-UNAUTHORIZED)
      )
    )
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (try! (validate-program-active program-id))
    (asserts! (not (get proof-submitted participant)) ERR-ALREADY_VERIFIED)
    (asserts! (<= (len proof-data) MAX-PROOF-LEN) ERR-INVALID-PARAM)
    (map-set proofs key
      {
        proof-data: proof-data,
        submission-block: (get-current-block),
        oracle-verified: false,
        verification-notes: notes
      }
    )
    (map-set participants key
      (merge participant { proof-submitted: true })
    )
    (print { event: "proof-submitted", program-id: program-id, user: caller })
    (ok true)
  )
)

(define-public (verify-proof (program-id uint) (user principal) (is-valid bool) (notes (optional (string-utf8 256))) (oracle <oracle-trait>))
  (let
    (
      (caller tx-sender)
      (key { program-id: program-id, user: user })
      (proof (unwrap! (map-get? proofs key) ERR-NOT-FOUND))
      (participant (unwrap! (map-get? participants key) ERR-UNAUTHORIZED))
    )
    (asserts! (is-eq caller (contract-call? oracle get-oracle-address)) ERR-UNAUTHORIZED)
    (asserts! (not (get oracle-verified proof)) ERR-ALREADY_VERIFIED)
    (if is-valid
      (begin
        (map-set proofs key
          (merge proof { oracle-verified: true, verification-notes: notes })
        )
        (map-set participants key
          (merge participant { verified: true, verification-block: (some (get-current-block)) })
        )
        (map-set programs program-id
          (merge (unwrap-panic (map-get? programs program-id))
            { verified-count: (+ (get verified-count (unwrap-panic (map-get? programs program-id))) u1) }
          )
        )
        (print { event: "proof-verified", program-id: program-id, user: user, valid: true })
        (ok true)
      )
      (begin
        (map-set proofs key
          (merge proof { oracle-verified: false, verification-notes: notes })
        )
        (print { event: "proof-verified", program-id: program-id, user: user, valid: false })
        (err ERR-INVALID-PROOF)
      )
    )
  )
)

(define-public (claim-reward (program-id uint) (distributor <distributor-trait>))
  (let
    (
      (caller tx-sender)
      (key { program-id: program-id, user: caller })
      (participant (unwrap! (map-get? participants key) ERR-UNAUTHORIZED))
      (program (unwrap! (map-get? programs program-id) ERR-PROGRAM-NOT-FOUND))
    )
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (try! (validate-program-active program-id))
    (asserts! (get verified participant) ERR-NOT-VERIFIED)
    (asserts! (not (get reward-claimed participant)) ERR-ALREADY_VERIFIED)
    (asserts! (>= (get budget program) (get reward-per-user program)) ERR-INSUFFICIENT-BUDGET)
    (try! (as-contract (contract-call? distributor distribute-reward program-id caller (get reward-per-user program))))
    (map-set participants key
      (merge participant { reward-claimed: true })
    )
    (map-set programs program-id
      (merge program { budget: (- (get budget program) (get reward-per-user program)) })
    )
    (map-set rewards-history key
      { amount: (get reward-per-user program), claim-block: (get-current-block) }
    )
    (print { event: "reward-claimed", program-id: program-id, user: caller, amount: (get reward-per-user program) })
    (ok (get reward-per-user program))
  )
)

(define-public (pause-contract)
  (begin
    (asserts! (is-admin tx-sender) ERR-NOT-ADMIN)
    (var-set paused true)
    (ok true)
  )
)

(define-public (unpause-contract)
  (begin
    (asserts! (is-admin tx-sender) ERR-NOT-ADMIN)
    (var-set paused false)
    (ok true)
  )
)

(define-public (update-program-budget (program-id uint) (new-budget uint))
  (let
    (
      (caller tx-sender)
      (program (unwrap! (map-get? programs program-id) ERR-PROGRAM-NOT-FOUND))
    )
    (asserts! (is-program-admin program-id caller) ERR-UNAUTHORIZED)
    (asserts! (> new-budget (get budget program)) ERR-INVALID-AMOUNT)  ;; Only allow increases for simplicity
    (map-set programs program-id
      (merge program { budget: new-budget })
    )
    (ok true)
  )
)

(define-public (deactivate-program (program-id uint))
  (let
    (
      (caller tx-sender)
    )
    (asserts! (is-program-admin program-id caller) ERR-UNAUTHORIZED)
    (map-set programs program-id
      (merge (unwrap-panic (map-get? programs program-id)) { active: false })
    )
    (ok true)
  )
)

;; Read-Only Functions
(define-read-only (get-program-details (program-id uint))
  (map-get? programs program-id)
)

(define-read-only (get-participant-status (program-id uint) (user principal))
  (map-get? participants { program-id: program-id, user: user })
)

(define-read-only (get-proof-details (program-id uint) (user principal))
  (map-get? proofs { program-id: program-id, user: user })
)

(define-read-only (get-reward-history (program-id uint) (user principal))
  (map-get? rewards-history { program-id: program-id, user: user })
)

(define-read-only (get-contract-paused)
  (var-get paused)
)

(define-read-only (get-program-count)
  (var-get program-counter)
)

(define-read-only (is-user-verified (program-id uint) (user principal))
  (match (map-get? participants { program-id: program-id, user: user })
    entry (get verified entry)
    false
  )
)

(define-read-only (calculate-remaining-budget (program-id uint))
  (match (map-get? programs program-id)
    program (get budget program)
    u0
  )
)