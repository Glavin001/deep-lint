# This file contains various pickle usage patterns
# Some are safe (trusted data), others are unsafe (untrusted input)

import pickle
import os


# UNSAFE: pickle.load from user-uploaded file
def load_user_upload(file_path: str):
    with open(file_path, "rb") as f:
        return pickle.load(f)


# UNSAFE: pickle.load from network data
def load_from_network(data: bytes):
    return pickle.loads(data)


# UNSAFE: pickle.load from external API response
def process_api_response(response_body: bytes):
    result = pickle.loads(response_body)
    return result


# SAFE: pickle.load from internal cache directory
def load_cache(cache_key: str):
    cache_dir = "/var/cache/myapp"
    cache_path = os.path.join(cache_dir, f"{cache_key}.pkl")
    with open(cache_path, "rb") as f:
        return pickle.load(f)


# SAFE: pickle.load from test fixture
def load_test_fixture(fixture_name: str):
    fixture_path = os.path.join("tests", "fixtures", f"{fixture_name}.pkl")
    with open(fixture_path, "rb") as f:
        return pickle.load(f)


# SAFE: pickle.dump (writing is not a security risk)
def save_model(model, path: str):
    with open(path, "wb") as f:
        pickle.dump(model, f)


# SAFE: using json instead of pickle
import json

def load_config(path: str):
    with open(path, "r") as f:
        return json.load(f)
