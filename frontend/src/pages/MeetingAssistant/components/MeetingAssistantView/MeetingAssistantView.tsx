import { useEffect, useRef } from 'react';
import { mountMeetingAssistant } from '../../model/mountMeetingAssistant';
import markup from './meetingAssistantMarkup.html?raw';

export function MeetingAssistantView() {
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    mountMeetingAssistant();
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: markup }} />;
}
