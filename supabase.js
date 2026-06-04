const SUPABASE_URL = 'https://whorwleydkziejjafsea.supabase.co';

const SUPABASE_ANON_KEY = 'sb_publishable_Iz2KPXd8D7bWIhyzOvObeg_GrLRVJma';

const db = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);