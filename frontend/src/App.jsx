import { useEffect, useRef, useState } from 'react'
import './App.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const BOT_URL = import.meta.env.VITE_BOT_URL || 'http://localhost:7860/api/offer'
const CALL_CONNECTION_TIMEOUT_MS = 75_000

function localDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const initialDate = new Date()
initialDate.setDate(initialDate.getDate() + 1)
const DEFAULT_APPOINTMENT_DATE = localDateString(initialDate)

function formatTime(dateString) {
  return new Date(dateString).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function Icon({ name, size = 20 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    doctors: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 8v6m-3-3h6" /></>,
    phone: <><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 2.8a2 2 0 0 1-.6 1.8L7.7 9.6a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 1.8-.6l2.8.5a2 2 0 0 1 1.7 2.7Z" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    sound: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function App() {
  const [doctors, setDoctors] = useState([])
  const [appointments, setAppointments] = useState([])
  const [availability, setAvailability] = useState([])
  const [specialization, setSpecialization] = useState('')
  const [appointmentDate, setAppointmentDate] = useState(DEFAULT_APPOINTMENT_DATE)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [patientName, setPatientName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [patientAddress, setPatientAddress] = useState('')
  const [notice, setNotice] = useState(null)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [booking, setBooking] = useState(false)
  const [apiOnline, setApiOnline] = useState(null)
  const [callOpen, setCallOpen] = useState(false)
  const [callState, setCallState] = useState('idle')
  const [callStarted, setCallStarted] = useState(null)
  const [callSeconds, setCallSeconds] = useState(0)
  const [muted, setMuted] = useState(false)
  const [transcript, setTranscript] = useState([])
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancellationPhone, setCancellationPhone] = useState('')
  const [cancellationError, setCancellationError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const clientRef = useRef(null)
  const callAttemptRef = useRef(0)
  const audioRef = useRef(null)
  const transcriptRef = useRef(null)

  async function loadAppointments() {
    const response = await fetch(`${API}/appointments`)
    if (!response.ok) throw new Error('Could not load appointments.')
    setAppointments(await response.json())
  }

  async function loadAvailability(specialty = specialization, date = appointmentDate) {
    setLoadingSlots(true)
    try {
      const params = new URLSearchParams({
        specialization: specialty,
        appointment_date: date,
      })
      const response = await fetch(`${API}/availability?${params}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not load available slots.')
      setAvailability(data)
      setSelectedSlot(null)
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally {
      setLoadingSlots(false)
    }
  }

  useEffect(() => {
    let active = true
    const availabilityParams = new URLSearchParams({
      specialization: '',
      appointment_date: DEFAULT_APPOINTMENT_DATE,
    })
    Promise.all([
      fetch(`${API}/doctors`).then(async (response) => {
        if (!response.ok) throw new Error('Could not load the doctor directory.')
        return response.json()
      }),
      fetch(`${API}/appointments`).then(async (response) => {
        if (!response.ok) throw new Error('Could not load appointments.')
        return response.json()
      }),
      fetch(`${API}/availability?${availabilityParams}`).then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.detail || 'Could not load available slots.')
        return data
      }),
    ])
      .then(([doctorData, appointmentData, availabilityData]) => {
        if (active) setApiOnline(true)
        if (active) {
          setDoctors(doctorData)
          setAppointments(appointmentData)
          setAvailability(availabilityData)
        }
      })
      .catch((error) => {
        if (active) {
          setApiOnline(false)
          setNotice({ type: 'error', text: error.message })
        }
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!callStarted || callState !== 'connected') return undefined
    const timer = window.setInterval(() => {
      setCallSeconds(Math.floor((Date.now() - callStarted) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [callStarted, callState])

  useEffect(() => {
    if (callState !== 'connected' && callState !== 'ended') return undefined
    let active = true
    let refreshFailed = false

    async function refreshAppointmentData() {
      try {
        const params = new URLSearchParams({
          specialization,
          appointment_date: appointmentDate,
        })
        const [appointmentsResponse, availabilityResponse] = await Promise.all([
          fetch(`${API}/appointments`),
          fetch(`${API}/availability?${params}`),
        ])
        const [appointmentData, availabilityData] = await Promise.all([
          appointmentsResponse.json(),
          availabilityResponse.json(),
        ])
        if (!appointmentsResponse.ok) {
          throw new Error(appointmentData.detail || 'Could not refresh appointments.')
        }
        if (!availabilityResponse.ok) {
          throw new Error(availabilityData.detail || 'Could not refresh available slots.')
        }
        if (!active) return
        setAppointments(appointmentData)
        setAvailability(availabilityData)
        setApiOnline(true)
        refreshFailed = false
      } catch (error) {
        if (!active || refreshFailed) return
        refreshFailed = true
        setApiOnline(false)
        setNotice({ type: 'error', text: error.message })
      }
    }

    refreshAppointmentData()
    if (callState !== 'connected') return () => { active = false }
    const timer = window.setInterval(refreshAppointmentData, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [appointmentDate, callState, specialization])

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [transcript])

  function addTranscriptMessage(role, text) {
    const content = text?.trim()
    if (!content) return
    setTranscript((current) => [...current, {
      id: `${Date.now()}-${Math.random()}`,
      role,
      text: content,
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    }])
  }

  async function startCall() {
    const attempt = ++callAttemptRef.current
    setCallOpen(true)
    setCallState('connecting')
    setTranscript([])
    setCallSeconds(0)
    setCallStarted(null)
    setMuted(false)
    setNotice(null)

    let client
    let hasConnected = false
    let connectionTimeout
    try {
      const [{ PipecatClient }, { SmallWebRTCTransport }] = await Promise.all([
        import('@pipecat-ai/client-js'),
        import('@pipecat-ai/small-webrtc-transport'),
      ])
      if (attempt !== callAttemptRef.current) return
      client = new PipecatClient({
        transport: new SmallWebRTCTransport(),
        enableMic: true,
        callbacks: {
          onTransportStateChanged: (state) => {
            if (clientRef.current !== client || attempt !== callAttemptRef.current) return
            if (state === 'ready') {
              hasConnected = true
              setCallState('connected')
              setCallStarted(Date.now())
            }
            if (state === 'error') {
              clientRef.current = null
              callAttemptRef.current += 1
              setCallState('error')
              setNotice({ type: 'error', text: 'Unable to connect to the voice agent. Check that it is running and try again.' })
              return
            }
            if (state === 'disconnected' && hasConnected) {
              clientRef.current = null
              callAttemptRef.current += 1
              setCallState('ended')
            }
          },
          onUserInput: (data) => {
            if (clientRef.current !== client || attempt !== callAttemptRef.current) return
            if (data.final) addTranscriptMessage('caller', data.text)
          },
          onBotOutput: (data) => {
            if (clientRef.current !== client || attempt !== callAttemptRef.current) return
            if (data.output_type === 'sentence') addTranscriptMessage('assistant', data.text)
          },
          onTrackStarted: (track, participant) => {
            if (clientRef.current !== client || attempt !== callAttemptRef.current) return
            if (participant?.local || track.kind !== 'audio') return
            const audio = new Audio()
            audio.autoplay = true
            audio.srcObject = new MediaStream([track])
            audioRef.current = audio
            audio.play().catch(() => {
              setNotice({ type: 'error', text: 'Allow audio playback in your browser to hear the assistant.' })
            })
          },
          onError: (message) => {
            if (clientRef.current !== client || attempt !== callAttemptRef.current) return
            const detail = message?.data?.error || message?.data?.message || 'The voice connection encountered an error.'
            setNotice({ type: 'error', text: detail })
          },
        },
      })
      clientRef.current = client
      const connection = client.connect({
        webrtcRequestParams: { endpoint: BOT_URL },
      }).then(async () => {
        if (
          attempt !== callAttemptRef.current &&
          ['ready', 'connected'].includes(client.state)
        ) {
          await client.disconnect()
        }
      })
      await Promise.race([
        connection,
        new Promise((_, reject) => {
          connectionTimeout = window.setTimeout(
            () => reject(new Error('The voice assistant did not connect in 75 seconds. It may be waking from an idle period; retry in a moment.')),
            CALL_CONNECTION_TIMEOUT_MS,
          )
        }),
      ])
    } catch (error) {
      if (attempt !== callAttemptRef.current || (client && clientRef.current !== client)) return
      callAttemptRef.current += 1
      clientRef.current = null
      setCallState('error')
      setNotice({ type: 'error', text: error.message || 'Could not connect to the voice assistant.' })
      if (client && ['ready', 'connected'].includes(client.state)) {
        try {
          await client.disconnect()
        } catch (disconnectError) {
          setNotice({
            type: 'error',
            text: `Could not connect to the voice assistant. Cleanup failed: ${disconnectError.message}`,
          })
        }
      }
    } finally {
      window.clearTimeout(connectionTimeout)
    }
  }

  async function endCall() {
    callAttemptRef.current += 1
    const client = clientRef.current
    clientRef.current = null
    try {
      if (client && ['ready', 'connected'].includes(client.state)) {
        await client.disconnect()
      }
    } catch (error) {
      setNotice({
        type: 'error',
        text: `Call ended, but the voice connection could not close cleanly: ${error.message}`,
      })
    } finally {
      if (audioRef.current) {
        audioRef.current.srcObject = null
        audioRef.current = null
      }
      setCallState('ended')
      setMuted(false)
    }
  }

  function toggleMute() {
    const nextMuted = !muted
    clientRef.current?.enableMic(!nextMuted)
    setMuted(nextMuted)
  }

  function closeCall() {
    callAttemptRef.current += 1
    if (clientRef.current) void endCall()
    setCallOpen(false)
    setCallState('idle')
  }

  async function handleBooking(event) {
    event.preventDefault()
    if (!selectedSlot) {
      setNotice({ type: 'error', text: 'Choose an available time before booking.' })
      return
    }
    const [time, period] = selectedSlot.time.split(' ')
    let [hours, minutes] = time.split(':').map(Number)
    if (period === 'PM' && hours !== 12) hours += 12
    if (period === 'AM' && hours === 12) hours = 0
    const appointmentTime = `${appointmentDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`

    setBooking(true)
    setNotice(null)
    try {
      const response = await fetch(`${API}/appointments/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_name: patientName,
          phone_number: phoneNumber,
          patient_address: patientAddress,
          doctor_id: selectedSlot.doctorId,
          appointment_time: appointmentTime,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Booking could not be completed.')

      setNotice({ type: 'success', text: `Appointment confirmed · #${data.appointment_id}` })
      setPatientName('')
      setPhoneNumber('')
      setPatientAddress('')
      setSelectedSlot(null)
      await Promise.all([loadAppointments(), loadAvailability(specialization, appointmentDate)])
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally {
      setBooking(false)
    }
  }

  function cancelAppointment(appointment) {
    setCancelTarget(appointment)
    setCancellationPhone('')
    setCancellationError('')
  }

  async function confirmCancellation(event) {
    event.preventDefault()
    if (!cancelTarget) return
    setCancelling(true)
    setCancellationError('')
    try {
      const response = await fetch(`${API}/appointments/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_id: cancelTarget.id,
          phone_number: cancellationPhone.trim(),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Cancellation could not be completed.')
      setNotice({ type: 'success', text: data.message })
      setCancelTarget(null)
      try {
        await loadAppointments()
      } catch (error) {
        setNotice({
          type: 'error',
          text: `The appointment was cancelled, but the list could not refresh: ${error.message}`,
        })
      }
    } catch (error) {
      setCancellationError(error.message)
    } finally {
      setCancelling(false)
    }
  }

  const activeAppointments = appointments.filter((appointment) => appointment.status === 'booked')
  const availableCount = availability.reduce((total, doctor) => total + doctor.available_slots.length, 0)
  const specialties = [...new Set(doctors.map((doctor) => doctor.specialization))].sort()
  const specialtyCount = specialties.length
  const doctorWord = doctors.length === 1 ? 'doctor' : 'doctors'
  const specialistWord = doctors.length === 1 ? 'specialist' : 'specialists'
  const specialtyWord = specialtyCount === 1 ? 'specialty' : 'specialties'
  const slotWord = availableCount === 1 ? 'slot' : 'slots'
  const formattedDuration = `${String(Math.floor(callSeconds / 60)).padStart(2, '0')}:${String(callSeconds % 60).padStart(2, '0')}`

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="CareConnect home">
          <span className="brand-mark"><span /></span>
          <span>care<span className="brand-light">connect</span></span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#overview"><Icon name="grid" /><span className="nav-text">Overview</span></a>
          <a className="nav-item" href="#availability"><Icon name="doctors" /><span className="nav-text">Find a doctor</span></a>
          <a className="nav-item" href="#appointments"><Icon name="calendar" /><span className="nav-text">Appointments</span><span className="nav-count">{activeAppointments.length}</span></a>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon"><Icon name="sound" size={18} /></div>
            <strong>Need a hand?</strong>
            <p>Our voice assistant can find a time that works for you.</p>
            <button type="button" onClick={startCall}>Talk to CareConnect <Icon name="arrow" size={16} /></button>
          </div>
          <div className="sidebar-profile">
            <div className="profile-avatar">CC</div>
            <div><strong>Care team</strong><small>Patient services</small></div>
            <span className="profile-menu">···</span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="breadcrumbs">Workspace <span>/</span> <strong>Overview</strong></div>
          <div className="topbar-right">
            <span className={`service-indicator ${apiOnline ? 'online' : ''}`}>
              <i /> {apiOnline === true ? 'Appointment API connected' : apiOnline === false ? 'Appointment API unavailable' : 'Checking appointment API'}
            </span>
            <span className="topbar-date">{new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <p className="eyebrow">A LITTLE MORE HUMAN</p>
              <h1>Care that starts<br className="mobile-break" /> by listening.</h1>
              <p className="welcome-copy">A calmer way to find the right specialist and make time for you.</p>
            </div>
            <button className="primary-button call-button" type="button" onClick={startCall}>
              <Icon name="phone" size={18} /> Try a voice call <span className="button-arrow"><Icon name="arrow" size={16} /></span>
            </button>
          </section>

          <section className="hero-card" aria-label="Voice appointment assistant">
            <div className="hero-copy">
              <div className="hero-kicker"><span className="pulse-dot" /> YOUR VOICE-FIRST CARE DESK</div>
              <h2>Say hello to<br />a better kind of booking.</h2>
              <p>Tell your care concierge what you need. We’ll find a specialist, check real availability, and handle the details together.</p>
              <button type="button" className="hero-link" onClick={startCall}>Start a conversation <Icon name="arrow" size={17} /></button>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orb-ring ring-one" />
              <div className="orb-ring ring-two" />
              <div className="hero-orb"><span className="orb-signal"><i /><i /><i /><i /><i /><i /><i /></span></div>
              <div className="hero-note note-top"><span className="mini-wave"><i /><i /><i /><i /></span><span>Here when you need us</span></div>
              <div className="hero-note note-bottom"><span className="note-check"><Icon name="check" size={13} /></span><span>Care, made simple</span></div>
            </div>
            <div className="hero-grain" />
          </section>

          {notice && (
            <div className={`notice ${notice.type}`} role="status">
              <span>{notice.text}</span>
              <button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><Icon name="close" size={17} /></button>
            </div>
          )}

          <section className="metrics" aria-label="Appointment overview">
            <article className="metric-card">
              <span className="metric-icon sage"><Icon name="doctors" size={19} /></span>
              <div><span className="metric-label">Care team</span><strong>{doctors.length}<small> {specialistWord}</small></strong></div>
              <span className="metric-caption">Across {specialtyCount} {specialtyWord}</span>
            </article>
            <article className="metric-card">
              <span className="metric-icon sand"><Icon name="calendar" size={19} /></span>
              <div><span className="metric-label">Upcoming visits</span><strong>{activeAppointments.length}<small> booked</small></strong></div>
              <span className="metric-caption">Your appointments</span>
            </article>
            <article className="metric-card">
              <span className="metric-icon blue"><Icon name="clock" size={19} /></span>
              <div><span className="metric-label">Open times</span><strong>{availableCount}<small> {slotWord}</small></strong></div>
              <span className="metric-caption">For your selected date</span>
            </article>
          </section>

          <section className="workspace-grid">
            <div className="panel availability-panel" id="availability">
              <div className="panel-heading">
                <div>
                  <p className="section-overline">THE RIGHT SPECIALIST</p>
                  <h2>Find a time that works</h2>
                </div>
                <span className="result-count">{doctors.length} {doctorWord}</span>
              </div>
              <form className="filters" onSubmit={(event) => {
                event.preventDefault()
                loadAvailability(specialization, appointmentDate)
              }}>
                <label className="filter-field">
                  <span>Specialty</span>
                  <select value={specialization} onChange={(event) => setSpecialization(event.target.value)}>
                    <option value="">All specialties</option>
                    {specialties.map((specialty) => <option key={specialty}>{specialty}</option>)}
                  </select>
                </label>
                <label className="filter-field date-filter">
                  <span>Date</span>
                  <input type="date" min={localDateString(new Date())} value={appointmentDate} onChange={(event) => setAppointmentDate(event.target.value)} />
                </label>
                <button className="search-button" type="submit" disabled={loadingSlots}>
                  <Icon name="search" size={17} /><span>{loadingSlots ? 'Checking' : 'Check slots'}</span>
                </button>
              </form>

              <div className="doctor-list">
                {availability.map((doctor, index) => (
                  <article className="doctor-row" key={doctor.doctor_id}>
                    <div className={`doctor-avatar avatar-${index % 4}`}>{doctor.doctor_name.split(' ').slice(-2).map((part) => part[0]).join('')}</div>
                    <div className="doctor-info">
                      <h3>{doctor.doctor_name}</h3>
                      <p>{doctor.specialization}<span className="doctor-dot">·</span> <span className="doctor-available">{doctor.available_slots.length ? `${doctor.available_slots.length} ${doctor.available_slots.length === 1 ? 'time' : 'times'} available` : 'No times available'}</span></p>
                    </div>
                    <div className="slot-list" aria-label={`Available times for ${doctor.doctor_name}`}>
                      {doctor.available_slots.length ? doctor.available_slots.map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          className={`slot-chip ${selectedSlot?.doctorId === doctor.doctor_id && selectedSlot?.time === slot ? 'selected' : ''}`}
                          onClick={() => setSelectedSlot({ doctorId: doctor.doctor_id, doctorName: doctor.doctor_name, time: slot })}
                        >
                          {slot}
                        </button>
                      )) : <span className="no-slots">Try another date</span>}
                    </div>
                  </article>
                ))}
                {!availability.length && !loadingSlots && (
                  <div className="empty-slots"><span className="empty-icon"><Icon name="calendar" size={20} /></span><strong>No doctors found</strong><p>Try a different specialty or date.</p></div>
                )}
              </div>
            </div>

            <aside className="booking-panel">
              <div className="booking-panel-top">
                <p className="section-overline">A GOOD NEXT STEP</p>
                <h2>Make it yours.</h2>
                <p>Choose a time with a specialist and we’ll save it for you.</p>
              </div>
              {selectedSlot ? (
                <form className="booking-form" onSubmit={handleBooking}>
                  <div className="selected-appointment">
                    <span className="selected-check"><Icon name="check" size={15} /></span>
                    <div><strong>{selectedSlot.doctorName}</strong><span>{new Date(`${appointmentDate}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {selectedSlot.time}</span></div>
                    <button type="button" aria-label="Remove selected slot" onClick={() => setSelectedSlot(null)}><Icon name="close" size={15} /></button>
                  </div>
                  <label className="form-field"><span>Your name</span><input value={patientName} onChange={(event) => setPatientName(event.target.value)} placeholder="e.g. Alex Morgan" required /></label>
                  <label className="form-field"><span>Phone number</span><input type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="10-digit number" pattern="[0-9]{10}" maxLength="10" required /></label>
                  <label className="form-field"><span>Home address</span><input autoComplete="street-address" value={patientAddress} onChange={(event) => setPatientAddress(event.target.value)} placeholder="Street, city, postal code" required /></label>
                  <button className="primary-button confirm-button" type="submit" disabled={booking}>{booking ? 'Saving your time…' : 'Confirm appointment'} <Icon name="arrow" size={16} /></button>
                  <p className="secure-note"><span /> Your phone and address are saved with this appointment.</p>
                </form>
              ) : (
                <div className="booking-empty">
                  <div className="booking-illustration"><Icon name="calendar" size={22} /></div>
                  <strong>Your next step is simple.</strong>
                  <p>Select any available time to see the booking details here.</p>
                  <button type="button" className="text-button" onClick={startCall}><Icon name="phone" size={15} /> Or book by voice</button>
                </div>
              )}
              <div className="booking-footer"><span>✳</span> A little less waiting. A little more care.</div>
            </aside>
          </section>

          <section className="panel appointments-panel" id="appointments">
            <div className="panel-heading appointments-heading">
              <div>
                <p className="section-overline">YOUR CARE PLAN</p>
                <h2>Appointments</h2>
              </div>
              <span className="result-count">{activeAppointments.length} upcoming</span>
            </div>
            {appointments.length ? (
              <div className="appointment-table-wrap">
                <table className="appointment-table">
                  <thead><tr><th>Patient</th><th>Doctor</th><th>Date &amp; time</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {appointments.map((appointment) => (
                      <tr key={appointment.id}>
                        <td><div className="patient-cell"><span className="patient-avatar">{appointment.patient_name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><strong>{appointment.patient_name}</strong></div></td>
                        <td><span className="table-doctor">{appointment.doctor_name}</span></td>
                        <td><span className="table-date">{formatTime(appointment.appointment_time)}</span></td>
                        <td><span className={`status-pill ${appointment.status}`}>{appointment.status}</span></td>
                        <td className="table-action">
                          {appointment.status === 'booked' && <button className="cancel-link" type="button" onClick={() => cancelAppointment(appointment)}>Cancel</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="appointments-empty"><span className="empty-icon"><Icon name="calendar" size={20} /></span><span><strong>No appointments yet</strong><small>When you book a visit, it’ll appear here.</small></span><button type="button" className="text-button" onClick={startCall}>Talk to the assistant <Icon name="arrow" size={15} /></button></div>
            )}
          </section>
          <footer className="page-footer"><span>CareConnect</span><span>Here for the moments that matter.</span><span>© {new Date().getFullYear()}</span></footer>
        </div>
      </main>

      {cancelTarget && (
        <div className="cancel-backdrop">
          <section className="cancel-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
            <header className="cancel-dialog-header">
              <span className="cancel-dialog-icon"><Icon name="calendar" size={19} /></span>
              <button type="button" className="icon-button" aria-label="Keep appointment" onClick={() => setCancelTarget(null)} disabled={cancelling}><Icon name="close" /></button>
            </header>
            <p className="section-overline">APPOINTMENT CHANGE</p>
            <h2 id="cancel-title">Cancel this visit?</h2>
            <p className="cancel-intro">Enter the phone number on the appointment. We’ll check it before making any changes.</p>
            <div className="cancel-summary">
              <strong>{cancelTarget.doctor_name}</strong>
              <span>{cancelTarget.patient_name} <i>·</i> {formatTime(cancelTarget.appointment_time)}</span>
            </div>
            <form className="cancel-form" onSubmit={confirmCancellation}>
              <label className="form-field">
                <span>Phone number on the appointment</span>
                <input
                  type="tel"
                  value={cancellationPhone}
                  onChange={(event) => setCancellationPhone(event.target.value)}
                  placeholder="10-digit number"
                  pattern="[0-9]{10}"
                  maxLength="10"
                  required
                />
              </label>
              {cancellationError && <p className="cancel-error" role="alert">{cancellationError}</p>}
              <div className="cancel-actions">
                <button type="button" className="keep-appointment" onClick={() => setCancelTarget(null)} disabled={cancelling}>Keep appointment</button>
                <button type="submit" className="confirm-cancel" disabled={cancelling}>{cancelling ? 'Cancelling…' : 'Confirm cancellation'}</button>
              </div>
            </form>
            <p className="cancel-privacy">Your phone number is only checked against this appointment.</p>
          </section>
        </div>
      )}

      {callOpen && (
        <div className="call-backdrop" role="presentation">
          <section className="call-window" role="dialog" aria-modal="true" aria-labelledby="call-title">
            <header className="call-header">
              <div className="call-brand"><span className="brand-mark small"><span /></span><span>careconnect</span></div>
              <button type="button" className="icon-button" aria-label="Close call window" onClick={closeCall}><Icon name="close" /></button>
            </header>
            <div className="call-profile">
              <div className={`call-avatar ${callState === 'connected' ? 'active' : ''}`}><span className="call-avatar-cross">+</span></div>
              <p className="call-label">CARECONNECT AI ASSISTANT</p>
              <h2 id="call-title">Let’s find your next visit.</h2>
              <div className={`call-state ${callState}`} aria-live="polite"><i />{callState === 'connecting' ? 'Connecting to your care team' : callState === 'connected' ? `Connected · ${formattedDuration}` : callState === 'error' ? 'Connection could not be made' : callState === 'ended' ? 'Call ended' : 'Ready when you are'}</div>
              <div className={`voice-bars ${callState === 'connected' ? 'live' : ''}`} aria-hidden="true">{Array.from({ length: 31 }, (_, index) => <i key={index} style={{ '--bar': `${12 + ((index * 17) % 47)}px`, '--delay': `${(index % 9) * 0.09}s` }} />)}</div>
            </div>
            <div className="transcript-area" ref={transcriptRef} aria-live="polite">
              {transcript.length ? transcript.map((message) => (
                <article className={`transcript-message ${message.role}`} key={message.id}>
                  <span className="transcript-speaker">{message.role === 'caller' ? 'YOU' : 'CARECONNECT'} <time>{message.time}</time></span>
                  <p>{message.text}</p>
                </article>
              )) : (
                <div className="transcript-placeholder">
                  <span className="transcript-line" />
                  <p>{callState === 'connected' ? 'Your conversation will appear here.' : 'Your live transcript will appear here.'}</p>
                </div>
              )}
            </div>
            {callState === 'error' && <p className="call-error">Check that the API and voice agent are running, then try again.</p>}
            <div className="call-controls">
              {callState === 'ended' || callState === 'error' ? (
                <button className="call-retry" type="button" onClick={startCall}><Icon name="phone" size={17} /> Try again</button>
              ) : (
                <>
                  <button className={`mute-control ${muted ? 'muted' : ''}`} type="button" onClick={toggleMute} disabled={callState !== 'connected'} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>
                    <Icon name="mic" size={19} /><span>{muted ? 'Unmute' : 'Mute'}</span>
                  </button>
                  <button className="end-call" type="button" onClick={endCall} aria-label="End call"><Icon name="phone" size={19} /></button>
                  <button className="sound-control" type="button" aria-label="Audio is on"><Icon name="sound" size={19} /><span>Audio</span></button>
                </>
              )}
            </div>
            <p className="call-footnote">For appointments only · No medical advice</p>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
